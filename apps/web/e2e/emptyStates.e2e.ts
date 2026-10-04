import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const tool = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name })

/** File › New plan: one floor, no walls, one access point (D20). */
async function newPlan(page: Page) {
  await openEditor(page)
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
}

/** Removes the new plan's access point, so none is left. */
async function removeAccessPoints(page: Page) {
  await panel(page).locator('.object-list').getByRole('button').first().click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
}

test.beforeEach(async ({ page }) => {
  await newPlan(page)
})

test('a plan with no walls says how to start, and the button picks Wall', async ({
  page,
}) => {
  await expect(panel(page)).toContainText('To start, pick Wall')
  await panel(page)
    .getByRole('button', { name: 'Draw your first wall' })
    .click()
  await expect(tool(page, 'Wall')).toHaveAttribute('aria-pressed', 'true')
  await expect(
    panel(page).getByRole('heading', { name: 'Wall tool' }),
  ).toBeVisible()
})

test('a plan with no survey spots offers the Survey tool', async ({ page }) => {
  await expect(panel(page)).toContainText('No survey spots yet.')
  await panel(page).getByRole('button', { name: 'Add survey spots' }).click()
  await expect(tool(page, 'Survey')).toHaveAttribute('aria-pressed', 'true')
  // The Survey tool's own list says where to click.
  await expect(panel(page)).toContainText(
    'No spots yet on any floor. Click the plan where you measured signal.',
  )
})

test('a plan with no neighbours’ networks says so beside Add a network', async ({
  page,
}) => {
  await expect(panel(page)).toContainText('No neighbours’ networks yet.')
  await panel(page).getByRole('button', { name: 'Add a network' }).click()
  await expect(panel(page)).not.toContainText('No neighbours’ networks yet.')
})

test('a floor with no access points offers the Access point tool', async ({
  page,
}) => {
  await expect(panel(page)).not.toContainText('No access points on this floor')
  await removeAccessPoints(page)
  await expect(panel(page)).toContainText('No access points on this floor yet.')
  // Planning channels explains itself too.
  await expect(panel(page)).toContainText('there are no radios to plan yet')
  await expect(panel(page)).toContainText(
    'Add an access point to see coverage.',
  )
  await panel(page)
    .locator('.access-points-empty')
    .getByRole('button', { name: 'Place an access point' })
    .click()
  await expect(tool(page, 'Access point')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the channel planner’s empty state also picks the Access point tool', async ({
  page,
}) => {
  await removeAccessPoints(page)
  await panel(page)
    .locator('.channel-plan')
    .getByRole('button', { name: 'Place an access point' })
    .click()
  await expect(tool(page, 'Access point')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('a survey spot without readings says so, and the report points to it', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await clickPlan(page, 2, 2)
  await expect(panel(page)).toContainText('No readings yet.')

  // Back on the plan, the report offers to add readings at the spot.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toContainText(
    'No readings yet. Add some to see how far the model is from what you measured.',
  )
  await expect(panel(page)).toContainText('Needs readings first')
  await panel(page)
    .locator('.report-empty')
    .getByRole('button', { name: /Add readings at Spot/ })
    .click()
  await expect(
    panel(page).getByRole('heading', { name: 'Readings' }),
  ).toBeVisible()
})

test('a survey spot on a plan with no access points offers to place one', async ({
  page,
}) => {
  await removeAccessPoints(page)
  await page.keyboard.press('s')
  await clickPlan(page, 2, 2)
  await expect(panel(page)).toContainText(
    'A reading is from an access point, and this plan has none yet.',
  )
  await panel(page)
    .locator('.readings-empty')
    .getByRole('button', { name: 'Place an access point' })
    .click()
  await expect(tool(page, 'Access point')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
