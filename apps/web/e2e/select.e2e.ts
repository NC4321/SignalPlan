import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint, summaryCount } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('selects a wall and changes its material', async ({ page }) => {
  // The office wall runs from (11, 0) to (11, 4); its door is at y 2.9–3.7.
  await clickPlan(page, 11, 1)
  await expect(
    panel(page).getByRole('heading', { name: 'Wall', exact: true }),
  ).toBeVisible()
  await expect(panel(page).locator('.kind')).toHaveText('Drywall')
  await panel(page)
    .getByRole('group', { name: 'Material', exact: true })
    .getByText('Concrete', { exact: true })
    .click()
  await expect(panel(page).locator('.kind')).toHaveText('Concrete')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(panel(page).locator('.kind')).toHaveText('Drywall')
})

test('drags a wall at right angles, stretching its neighbours', async ({
  page,
}) => {
  const start = await screenPoint(page, 11, 1)
  // Drag mostly right and a little down: only the sideways part applies.
  const end = await screenPoint(page, 12, 1.4)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move((start.x + end.x) / 2, start.y, { steps: 3 })
  await page.mouse.move(end.x, end.y, { steps: 3 })
  await page.mouse.up()

  await clickPlan(page, 12, 0) // the wall's top corner moved to (12, 0)
  await expect(
    panel(page).getByRole('heading', { name: 'Corner' }),
  ).toBeVisible()
  await expect(panel(page).locator('dd').first()).toHaveText('12.00 m, 0.00 m')
})

test('joins a corner dropped on another corner', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.keyboard.press('w')
  await clickPlan(page, 17, 2)
  await clickPlan(page, 17, 4)
  await page.keyboard.press('Escape')
  await clickPlan(page, 18, 2)
  await clickPlan(page, 18, 4)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  const from = await screenPoint(page, 18, 4)
  const to = await screenPoint(page, 17, 4)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()

  await clickPlan(page, 17, 4)
  await expect(panel(page).locator('.kind')).toHaveText('Joins 2 walls')
})

test('deleting a wall merges the straight halves it leaves', async ({
  page,
}) => {
  const before = await summaryCount(page, 'Walls')
  // The wall between bedroom 1 and the bathroom, y = 4 from x 0 to 5.
  await clickPlan(page, 2.5, 4)
  await expect(
    panel(page).getByRole('heading', { name: 'Wall', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Delete')
  // One wall gone, and two pairs of straight halves merged.
  expect(await summaryCount(page, 'Walls')).toBe(before - 3)
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Undo Delete wall/,
  )
  await page.keyboard.press('ControlOrMeta+z')
  expect(await summaryCount(page, 'Walls')).toBe(before)
})

test('double-click splits a wall and selects the new corner', async ({
  page,
}) => {
  const before = await summaryCount(page, 'Walls')
  const at = await screenPoint(page, 11, 1)
  await page.mouse.dblclick(at.x, at.y)
  await expect(
    panel(page).getByRole('heading', { name: 'Corner' }),
  ).toBeVisible()
  await expect(panel(page).locator('.kind')).toHaveText('Joins 2 walls')
  await page.keyboard.press('Escape')
  expect(await summaryCount(page, 'Walls')).toBe(before + 1)
})

test('sets a wall length by typing', async ({ page }) => {
  await clickPlan(page, 11, 1)
  const length = panel(page).getByLabel('Length')
  await expect(length).toHaveValue('4.00 m')
  await length.fill('3.5')
  await length.press('Enter')
  await expect(length).toHaveValue('3.50 m')
  await length.fill('nonsense')
  await length.press('Enter')
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await length.press('Escape')
  await expect(length).toHaveValue('3.50 m')
})

test('deleting a corner between two walls joins them', async ({ page }) => {
  const before = await summaryCount(page, 'Walls')
  await clickPlan(page, 0, 0) // the house's top-left corner
  await expect(panel(page).locator('.kind')).toHaveText('Joins 2 walls')
  await panel(page).getByRole('button', { name: 'Delete' }).click()
  await page.keyboard.press('Escape')
  expect(await summaryCount(page, 'Walls')).toBe(before - 1)
})

test('shift-click builds a multiple selection', async ({ page }) => {
  await clickPlan(page, 11, 1)
  const extra = await screenPoint(page, 2.5, 4)
  await page.keyboard.down('Shift')
  await page.mouse.click(extra.x, extra.y)
  await page.keyboard.up('Shift')
  await expect(
    panel(page).getByRole('heading', { name: '2 selected' }),
  ).toBeVisible()
})
