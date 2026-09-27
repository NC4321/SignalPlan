import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint, summaryCount } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const openings = async (page: Page) => {
  await page.keyboard.press('Escape') // clear the selection
  await page.keyboard.press('Escape') // back to Select, showing the summary
  return summaryCount(page, 'Doors and windows')
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('adds a door with the door tool', async ({ page }) => {
  const before = await summaryCount(page, 'Doors and windows')
  await page.keyboard.press('d')
  // The living room / bedroom 1 wall at x = 5; its door is at y 2.9–3.7.
  await clickPlan(page, 5, 1)
  await expect(
    panel(page).getByRole('heading', { name: 'Door', exact: true }),
  ).toBeVisible()
  await expect(panel(page).getByLabel('Width')).toHaveValue('0.81 m')
  await expect(panel(page).locator('.kind')).toHaveText('Wood')
  expect(await openings(page)).toBe(before + 1)
})

test('slides a new window to fit beside a corner', async ({ page }) => {
  await page.keyboard.press('n')
  await clickPlan(page, 0, 0.3) // left wall of bedroom 1, near the corner
  await expect(
    panel(page).getByRole('heading', { name: 'Window', exact: true }),
  ).toBeVisible()
  await expect(panel(page).getByLabel('Width')).toHaveValue('1.22 m')
  await expect(panel(page).locator('.kind')).toHaveText('Glass')
})

test('refuses a door where the wall has no room', async ({ page }) => {
  const before = await summaryCount(page, 'Doors and windows')
  await page.keyboard.press('d')
  // The bathroom's outside wall is 2 m long with a window in the middle,
  // leaving 0.7 m either side: too narrow for a 0.81 m door.
  await clickPlan(page, 0, 5.6)
  expect(await openings(page)).toBe(before)
})

test('edits a selected door', async ({ page }) => {
  // The office door, on the wall at x = 11 from y 2.9 to 3.7.
  await clickPlan(page, 11, 3.3)
  await expect(
    panel(page).getByRole('heading', { name: 'Door', exact: true }),
  ).toBeVisible()
  const width = panel(page).getByLabel('Width')
  await width.fill('1')
  await width.press('Enter')
  await expect(width).toHaveValue('1.00 m')
  await panel(page)
    .getByRole('group', { name: 'Material', exact: true })
    .getByText('Open (no door)')
    .click()
  await expect(panel(page).locator('.kind')).toHaveText('Open (no door)')
  await panel(page).getByText('Window', { exact: true }).click()
  await expect(
    panel(page).getByRole('heading', { name: 'Window', exact: true }),
  ).toBeVisible()
})

test('drags a door along its wall', async ({ page }) => {
  const from = await screenPoint(page, 11, 3.3)
  const to = await screenPoint(page, 11.4, 1.3) // sideways part is ignored
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  // Now centred at y 1.3: clicking there finds the door.
  await page.keyboard.press('Escape')
  await clickPlan(page, 11, 1.3)
  await expect(
    panel(page).getByRole('heading', { name: 'Door', exact: true }),
  ).toBeVisible()
})

test('deletes a selected window', async ({ page }) => {
  const before = await summaryCount(page, 'Doors and windows')
  await clickPlan(page, 0, 5) // the bathroom window, at y 4.7–5.3
  await expect(
    panel(page).getByRole('heading', { name: 'Window', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Delete')
  expect(await openings(page)).toBe(before - 1)
})
