import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint } from './helpers.ts'

const floors = (page: Page) => page.getByRole('navigation', { name: 'Floors' })
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const tool = (page: Page) =>
  page
    .getByRole('toolbar', { name: 'Tools' })
    .getByRole('button', { name: 'Floor opening' })
const status = (page: Page) => page.locator('.coverage-status')

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/** Draws a closed room on the floor on show, tracing the floor below. */
async function drawRoom(page: Page, corners: [number, number][]) {
  await page.keyboard.press('w')
  for (const [x, y] of [...corners, corners[0]!]) await clickPlan(page, x, y)
  await page.keyboard.press('Escape')
}

test('draws a stairwell that cuts the floor, with undo (D54)', async ({
  page,
}) => {
  // The lowest floor has nothing below to open onto.
  await expect(tool(page)).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('o')
  await expect(
    page.getByRole('heading', { name: 'Floor opening tool' }),
  ).toHaveCount(0)

  await floors(page).getByRole('button', { name: '+ Floor above' }).click()
  await expect(tool(page)).not.toHaveAttribute('aria-disabled')
  await drawRoom(page, [
    [0, 0],
    [15, 0],
    [15, 8],
    [0, 8],
  ])
  await expect(status(page)).toContainText('of 120 m²')

  // A 3 × 2 m stairwell over the router, closed on its first corner.
  await page.keyboard.press('o')
  await expect(
    panel(page).getByRole('heading', { name: 'Floor opening tool' }),
  ).toBeVisible()
  for (const [x, y] of [
    [4, 0.5],
    [7, 0.5],
    [7, 2.5],
    [4, 2.5],
    [4, 0.5],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await expect(
    panel(page).getByRole('heading', { name: 'Floor opening', exact: true }),
  ).toBeVisible()
  await expect(panel(page).locator('dd').first()).toHaveText('6 m²')
  // 120 − 6 m² of floor.
  await expect(status(page)).toContainText('of 114 m²')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(status(page)).toContainText('of 120 m²')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(status(page)).toContainText('of 114 m²')

  // Selected with the Select tool, it drags as a whole and deletes.
  await page.keyboard.press('v')
  await clickPlan(page, 5, 1.2)
  const from = await screenPoint(page, 5, 1.2)
  const to = await screenPoint(page, 5, 4.2)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Move floor opening/,
  )
  await page.keyboard.press('Delete')
  await expect(status(page)).toContainText('of 120 m²')
})

test('Esc drops an outline and undo steps back one corner', async ({
  page,
}) => {
  await floors(page).getByRole('button', { name: '+ Floor above' }).click()
  await drawRoom(page, [
    [0, 0],
    [15, 0],
    [15, 8],
    [0, 8],
  ])
  const undo = page.getByRole('button', { name: 'Undo' })
  const before = await undo.getAttribute('title')
  await page.keyboard.press('o')
  await clickPlan(page, 4, 0.5)
  await clickPlan(page, 9, 0.5)
  await page.keyboard.press('ControlOrMeta+z')
  await clickPlan(page, 7, 0.5)
  await clickPlan(page, 7, 2.5)
  // Enter closes the triangle (4, 0.5), (7, 0.5), (7, 2.5): 3 m².
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('of 117 m²')

  await clickPlan(page, 10, 3)
  await clickPlan(page, 12, 3)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(undo).toHaveAttribute('title', /Add floor opening/)
  expect(before).not.toMatch(/floor opening/)
})
