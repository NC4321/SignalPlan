import { expect, test } from '@playwright/test'
import { openEditor, planPoint, screenPoint } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('opens the sample home with a live heatmap', async ({ page }) => {
  const properties = page.getByRole('complementary', { name: 'Properties' })
  await expect(
    properties.getByRole('heading', { level: 2 }).first(),
  ).toHaveText('Sample bungalow')
  const canvas = page.locator('.editor-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.readout')).toContainText(/-\d+ dBm · \w+/)
})

test('says how to start on an empty plan, until there are walls', async ({
  page,
}) => {
  const properties = page.getByRole('complementary', { name: 'Properties' })
  const hint = properties.getByText(/To start, pick Wall/)
  await expect(hint).toBeHidden()
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await expect(hint).toBeVisible()

  await page.keyboard.press('w')
  const a = await screenPoint(page, 1, 1)
  const b = await screenPoint(page, 3, 1)
  await page.mouse.click(a.x, a.y)
  await page.mouse.dblclick(b.x, b.y)
  await page.keyboard.press('Escape')
  await expect(hint).toBeHidden()
})

test('moves an access point with the keyboard, then undoes it', async ({
  page,
}) => {
  const properties = page.getByRole('complementary', { name: 'Properties' })
  await properties
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  const position = properties.locator('dd').first()
  await expect(position).toHaveText('5.60 m, 1.20 m')

  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(position).toHaveText('6.10 m, 1.30 m')

  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toHaveAttribute('title', /Undo Move Wi-Fi 6E router/)
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(position).toHaveText('5.60 m, 1.20 m')

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(position).toHaveText('6.10 m, 1.20 m')
})

test('switches display units', async ({ page }) => {
  const properties = page.getByRole('complementary', { name: 'Properties' })
  await properties
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.getByText('Imperial', { exact: true }).click()
  await expect(properties.locator('dd').first()).toHaveText('18′ 4½″, 3′ 11″')
})

test('drags an access point as a single undo step', async ({ page }) => {
  const router = await screenPoint(page, 5.6, 1.2)
  await page.mouse.move(router.x, router.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(router.x + i * 10, router.y + i * 5)
  }
  await page.mouse.up()

  const properties = page.getByRole('complementary', { name: 'Properties' })
  const position = properties.locator('dd').first()
  await expect(
    properties.getByText('Access point', { exact: true }),
  ).toBeVisible()
  await expect(position).not.toHaveText('5.60 m, 1.20 m')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(position).toHaveText('5.60 m, 1.20 m')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
})

test('zooms at the cursor with Ctrl + wheel, and fits back', async ({
  page,
}) => {
  const canvas = page.locator('.editor-canvas')
  const scale = () => canvas.evaluate((el) => Number(el.dataset['scale']))
  const fitted = await scale()

  // Whole pixels: browsers round pointer positions, and zoom magnifies errors.
  const corner = await screenPoint(page, 0, 0)
  const cursor = { x: Math.round(corner.x), y: Math.round(corner.y) }
  const before = await planPoint(page, cursor)
  await page.mouse.move(cursor.x, cursor.y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  await expect.poll(scale).toBeGreaterThan(fitted * 2)
  // The plan point under the cursor stays under it.
  const after = await planPoint(page, cursor)
  expect(after.x).toBeCloseTo(before.x, 3)
  expect(after.y).toBeCloseTo(before.y, 3)

  await page.getByRole('button', { name: 'Fit' }).click()
  await expect.poll(scale).toBeCloseTo(fitted, 3)
})

test('pans with the wheel', async ({ page }) => {
  const before = await screenPoint(page, 0, 0)
  const box = (await page.locator('.editor-canvas').boundingBox())!
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.wheel(40, 60)
  await expect
    .poll(async () => (await screenPoint(page, 0, 0)).y)
    .toBeCloseTo(before.y - 60, 0)
})
