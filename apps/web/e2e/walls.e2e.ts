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
