import { expect, test } from '@playwright/test'
import { clickPlan, openEditor, screenPoint, summaryCount } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await openEditor(page)
  // Zoom out so there is empty space beside the sample home to draw in.
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
})

const walls = (page: Parameters<typeof summaryCount>[0]) =>
  summaryCount(page, 'Walls')

test('draws and closes a room with the wall tool', async ({ page }) => {
  const before = await walls(page)
  await page.getByRole('button', { name: 'Wall' }).click()
  for (const [x, y] of [
    [17, 2],
    [19, 2],
    [19, 4],
    [17, 4],
    [17, 2],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape') // back to Select
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(await walls(page)).toBe(before + 4)
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Undo Draw wall/,
  )
})

test('places a wall at a typed length', async ({ page }) => {
  const before = await walls(page)
  await page.keyboard.press('w')
  await clickPlan(page, 17, 6)
  const east = await screenPoint(page, 18.3, 6)
  await page.mouse.move(east.x, east.y)
  await page.keyboard.type('2.5')
  const length = page.getByRole('textbox', { name: 'Length' })
  await expect(length).toBeFocused()
  await expect(length).toHaveValue('2.5')
  // The box must not lose the wall's direction (it points east, 0°).
  await expect(page.getByRole('textbox', { name: 'Angle' })).toHaveAttribute(
    'placeholder',
    '0°',
  )
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  expect(await walls(page)).toBe(before + 1)

  // The new wall ends 2.5 m east: hovering there reads 19.50 m.
  const end = await screenPoint(page, 19.5, 6)
  await page.mouse.move(end.x, end.y)
  await expect(page.locator('.readout')).toContainText('19.50 m, 6.00 m')
})

test('rejects an invalid typed length', async ({ page }) => {
  await page.keyboard.press('w')
  await clickPlan(page, 17, 6)
  await page.keyboard.type('.')
  await page.keyboard.type('x')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Try 3.5')
})

test('joins a new wall to an existing one (T junction)', async ({ page }) => {
  const before = await walls(page)
  await page.keyboard.press('w')
  // Top wall of the living room, between the front door and the window.
  await clickPlan(page, 8, 0)
  await clickPlan(page, 8, 3)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // The new wall, plus the existing wall split in two.
  expect(await walls(page)).toBe(before + 2)
})

test('undo mid-chain steps back one corner', async ({ page }) => {
  const before = await walls(page)
  await page.keyboard.press('w')
  await clickPlan(page, 17, 2)
  await clickPlan(page, 19, 2)
  await clickPlan(page, 19, 4)
  await page.keyboard.press('ControlOrMeta+z')
  await clickPlan(page, 21, 2) // continues from (19, 2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  expect(await walls(page)).toBe(before + 2)
})

test('drags the router with the wall tool between chains (D38)', async ({
  page,
}) => {
  const before = await walls(page)
  const wallTool = page.getByRole('button', { name: 'Wall' })
  const undo = page.getByRole('button', { name: 'Undo' })
  await wallTool.click()
  for (const [x, y] of [
    [17, 2],
    [19, 2],
    [19, 4],
    [17, 4],
    [17, 2],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await expect(wallTool).toHaveAttribute('aria-pressed', 'true')

  // With the room closed, a press on the router grabs it, in the wall tool.
  const router = await screenPoint(page, 5.6, 1.2)
  const to = await screenPoint(page, 7.6, 2.2)
  await page.mouse.move(router.x, router.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await expect(undo).toHaveAttribute('title', /Undo Move Wi-Fi 6E router/)
  await expect(wallTool).toHaveAttribute('aria-pressed', 'true')

  // Undo puts it back in one step, and no wall was started from it.
  await undo.click()
  await expect(undo).toHaveAttribute('title', /Undo Draw wall/)
  // Esc leaves the wall tool, and again clears the router's selection.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  expect(await walls(page)).toBe(before + 4)
  await page.mouse.click(router.x, router.y)
  const panel = page.getByRole('complementary', { name: 'Properties' })
  await expect(panel.locator('dd').first()).toHaveText('5.60 m, 1.20 m')
})

test('mid-chain, or with Alt, a press on the router places a corner', async ({
  page,
}) => {
  const undo = page.getByRole('button', { name: 'Undo' })
  const router = await screenPoint(page, 5.6, 1.2)
  await page.keyboard.press('w')

  // Mid-chain: the click on the router places the wall's end.
  await clickPlan(page, 3, 2)
  await page.mouse.click(router.x, router.y)
  await expect(undo).toHaveAttribute('title', /Undo Draw wall/)
  await page.keyboard.press('Escape')

  // Between chains, Alt starts a wall at the router instead of grabbing it.
  await undo.click()
  await expect(undo).toBeDisabled()
  await page.keyboard.down('Alt')
  await page.mouse.click(router.x, router.y)
  await page.keyboard.up('Alt')
  await clickPlan(page, 3, 3)
  await expect(undo).toHaveAttribute('title', /Undo Draw wall/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.mouse.click(router.x, router.y)
  const panel = page.getByRole('complementary', { name: 'Properties' })
  await expect(panel.locator('dd').first()).toHaveText('5.60 m, 1.20 m')
})
