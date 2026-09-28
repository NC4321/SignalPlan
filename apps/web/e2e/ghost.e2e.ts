import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const floors = (page: Page) => page.getByRole('navigation', { name: 'Floors' })
const ghostToggle = (page: Page) => floors(page).getByLabel('Show floor below')
const wallAngle = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Properties' })
    .locator('dt', { hasText: 'Angle' })
    .locator('xpath=following-sibling::dd[1]')
const wallLength = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('textbox', { name: 'Length' })

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/** Draws one wall between two points, then selects it by clicking `select`. */
async function drawWall(
  page: Page,
  from: [number, number],
  to: [number, number],
  select: [number, number],
) {
  await page.keyboard.press('w')
  await clickPlan(page, ...from)
  await clickPlan(page, ...to)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await clickPlan(page, ...select)
}

test('snaps to the corners of the floor below, and can be turned off (D53)', async ({
  page,
}) => {
  // Nothing below the only floor.
  await expect(ghostToggle(page)).toHaveCount(0)
  await floors(page).getByRole('button', { name: '+ Floor above' }).click()
  await expect(ghostToggle(page)).toBeChecked()

  // The sample home has corners at (0, 0) and (5, 4). Clicks a few
  // centimetres off land on them: √41 = 6.40 m, at 360° − atan(4/5) = 321° (angles run anticlockwise on screen).
  await drawWall(page, [0.04, 0.05], [5.04, 3.95], [2.5, 2])
  await expect(wallLength(page)).toHaveValue('6.40 m')
  await expect(wallAngle(page)).toHaveText('321°')
  await page.keyboard.press('ControlOrMeta+z')

  // With the floor below hidden, the first click lands on the grid at
  // (0, 0) and the second on the 315° step instead.
  await ghostToggle(page).uncheck()
  await drawWall(page, [0.04, 0.05], [5.04, 3.95], [2.26, 2.26])
  await expect(wallAngle(page)).toHaveText('315°')

  // The lowest floor has no floor below to show.
  await floors(page).getByRole('button', { name: 'Main floor' }).click()
  await expect(ghostToggle(page)).toHaveCount(0)
})
