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
  await expect(panel(page)).toContainText('No walls on this floor yet.')
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
  await expect(panel(page)).toContainText(
    'Plan channels needs an access point first.',
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
  await expect(panel(page)).toContainText('No readings to fit yet')
  await panel(page)
    .locator('.report-empty')
    .getByRole('button', { name: /Add readings at Spot/ })
    .click()
  await expect(
    panel(page).getByRole('heading', { name: 'Readings' }),
  ).toBeVisible()
})

test('a survey spot on a plan with no access points says to place one', async ({
  page,
}) => {
  await removeAccessPoints(page)
  await page.keyboard.press('s')
  await clickPlan(page, 2, 2)
  await expect(panel(page)).toContainText(
    'A reading is from an access point: place one first.',
  )
  // One button for it in the panel, under Access points.
  await expect(
    panel(page).getByRole('button', { name: 'Place an access point' }),
  ).toHaveCount(0)
})

test('an access point on another floor leaves this floor’s empty state, not the channel planner’s', async ({
  page,
}) => {
  await page
    .getByRole('navigation', { name: 'Floors' })
    .getByRole('button', { name: '+ Floor above' })
    .click()
  await expect(panel(page)).toContainText('No access points on this floor yet.')
  await expect(panel(page)).not.toContainText('Plan channels needs')
  await expect(
    panel(page).getByRole('button', { name: 'Plan channels' }),
  ).toBeEnabled()
  await expect(
    panel(page).getByRole('button', { name: 'Place an access point' }),
  ).toHaveCount(1)
})

test('readings whose band is off get no empty state, and the skipped line explains', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await clickPlan(page, 2, 2)
  await panel(page).getByRole('button', { name: 'Add a reading' }).click()
  await panel(page).getByRole('combobox', { name: /Band/ }).selectOption('5GHz')
  const signal = panel(page).getByRole('textbox', { name: /Signal \(dBm\)/ })
  await signal.fill('-60')
  await signal.press('Enter')

  // Turn 5 GHz off on the router.
  await tool(page, 'Select').click()
  await page.keyboard.press('Escape')
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await panel(page)
    .getByRole('checkbox', { name: '5 GHz', exact: true })
    .uncheck()
  await page.keyboard.press('Escape')

  await expect(panel(page)).toContainText('1 reading isn’t compared')
  await expect(panel(page)).not.toContainText('No readings yet.')
  await expect(panel(page).locator('.report-empty')).toHaveCount(0)
  await expect(panel(page)).not.toContainText(
    'Add readings to see how far the model',
  )
})
