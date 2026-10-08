import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const coverageStatus = (page: Page) => page.locator('.coverage-status')
const optimizerStatus = (page: Page) => panel(page).locator('.optimizer-status')
const find = (page: Page) =>
  panel(page).getByRole('button', {
    name: 'Find a better spot for Router',
  })

test('suggests a spot, previews it and applies it as one undo step (D44)', async ({
  page,
}) => {
  await openEditor(page)
  await expect(coverageStatus(page)).toHaveText(/^86% of/)
  await find(page).click()

  // D42: the sample home's router goes from 86.9% to 92.0% at Fair on 5 GHz.
  await expect(optimizerStatus(page)).toContainText(
    '86% → 92% of the floor at Fair or better on 5 GHz.',
  )
  await expect(optimizerStatus(page)).toContainText('Move Router to')
  // The heatmap and status bar show coverage with the suggestion in place.
  await expect(coverageStatus(page)).toHaveText(
    /^With the suggestion: 92% of .* at Fair or better on 5 GHz\.$/,
  )
  await expect(panel(page)).toContainText('mesh backhaul isn’t modelled')

  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(coverageStatus(page)).toHaveText(/^92% of/)
  await expect(
    panel(page).getByRole('heading', { name: 'Router' }),
  ).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'Apply' })).toHaveCount(
    0,
  )

  await page.keyboard.press('Control+z')
  await expect(coverageStatus(page)).toHaveText(/^86% of/)
})

test('Dismiss and Esc discard the suggestion', async ({ page }) => {
  await openEditor(page)
  await find(page).click()
  await panel(page).getByRole('button', { name: 'Dismiss' }).click()
  await expect(coverageStatus(page)).toHaveText(/^86% of/)
  await expect(optimizerStatus(page)).toBeHidden()

  await find(page).click()
  await expect(coverageStatus(page)).toHaveText(/^With the suggestion/)
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Escape')
  await expect(coverageStatus(page)).toHaveText(/^86% of/)
})

test('an edit or band change drops the suggestion, saying why', async ({
  page,
}) => {
  await openEditor(page)
  await find(page).click()
  await expect(panel(page).getByRole('button', { name: 'Apply' })).toBeVisible()
  await page.getByText('2.4 GHz', { exact: true }).click()
  await expect(page.locator('.status-notice')).toHaveText(
    'Suggestion dismissed: the band changed.',
  )
  await expect(panel(page).getByRole('button', { name: 'Apply' })).toHaveCount(
    0,
  )
})

test('shows progress and Cancel while it searches', async ({ page }) => {
  // Hold the worker script back, so the search waits where Cancel can stop it.
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(/placement\.worker/, async (route) => {
    await held
    await route.continue()
  })
  await openEditor(page)
  await find(page).click()
  await expect(optimizerStatus(page)).toHaveText(
    'Searching for a spot for Router…',
  )
  await expect(
    panel(page).getByRole('progressbar', { name: 'Search progress' }),
  ).toBeVisible()
  const cancel = panel(page).getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeFocused()
  await cancel.press('Enter')
  release()
  await expect(find(page)).toBeFocused()
  await expect(optimizerStatus(page)).toBeHidden()
  await expect(coverageStatus(page)).toHaveText(/^86% of/)
})

test('works from the keyboard, keeping focus in the panel', async ({
  page,
}) => {
  await openEditor(page)
  await find(page).focus()
  await page.keyboard.press('Enter')
  const apply = panel(page).getByRole('button', { name: 'Apply' })
  await expect(apply).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(coverageStatus(page)).toHaveText(/^92% of/)
})

test('moves several unlocked access points together (D45)', async ({
  page,
}) => {
  await openEditor(page)
  await page.keyboard.press('a')
  await page.locator('.editor-canvas').click({ position: { x: 40, y: 40 } })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await panel(page)
    .getByRole('button', { name: 'Find better spots for 2 access points' })
    .click()
  await expect(optimizerStatus(page)).toContainText(
    /^Move Router to .* and move Access point 1 to .*: \d+% → \d+% of the floor/,
  )
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(
    panel(page).getByRole('heading', { name: '2 selected' }),
  ).toBeVisible()
})

test('suggests one more access point and applies both (D45)', async ({
  page,
}) => {
  await openEditor(page)
  await panel(page)
    .getByRole('button', { name: 'Suggest one more access point' })
    .click()
  await expect(optimizerStatus(page)).toContainText(
    /^Move Router to .* and add Access point 1 at .*: 86% → 100% of the floor at Fair or better on 5 GHz\.$/,
  )
  await expect(coverageStatus(page)).toHaveText(/^With the suggestion: 100% of/)
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(coverageStatus(page)).toHaveText(/^100% of/)
  await expect(
    panel(page).getByRole('heading', { name: '2 selected' }),
  ).toBeVisible()

  // One undo step takes both back.
  await page.keyboard.press('Control+z')
  await expect(coverageStatus(page)).toHaveText(/^86% of/)
  await expect(
    panel(page).getByRole('button', { name: 'Access point 1', exact: true }),
  ).toHaveCount(0)
})

test('adds an access point to a floor without one', async ({ page }) => {
  await openEditor(page)
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await panel(page)
    .getByRole('button', { name: 'Find the best spot for an access point' })
    .click()
  await expect(optimizerStatus(page)).toContainText('Add Access point 1 at')
  await expect(optimizerStatus(page)).toContainText('0% →')
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(
    panel(page).getByRole('heading', { name: 'Access point 1' }),
  ).toBeVisible()
})

test('counts the access points needed for the coverage goal (D46)', async ({
  page,
}) => {
  await openEditor(page)
  const howMany = panel(page).getByRole('button', {
    name: 'How many access points do I need?',
  })
  const goal = panel(page).getByLabel('Coverage goal')
  await expect(goal).toHaveValue('0.9')

  // Moving the router alone reaches 92% (D42), which meets 90%.
  await howMany.click()
  await expect(optimizerStatus(page)).toContainText(
    /^No more access points needed for 90% of the floor\. Move Router to .*: 86% → 92% of the floor/,
  )
  await panel(page).getByRole('button', { name: 'Dismiss' }).click()

  // The whole floor takes one more (D45).
  await goal.selectOption({ label: '100% of the floor' })
  await howMany.click()
  await expect(optimizerStatus(page)).toContainText(
    /^You need 1 more access point for 100% of the floor\. Move Router to .* and add Access point 1 at .*: 86% → 100% of the floor at Fair or better on 5 GHz\.$/,
  )
  await expect(coverageStatus(page)).toHaveText(/^With the suggestion: 100% of/)
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(coverageStatus(page)).toHaveText(/^100% of/)
  await page.keyboard.press('Control+z')
  await expect(coverageStatus(page)).toHaveText(/^86% of/)

  // The goal isn't saved in the plan, and resets on reload.
  await page.keyboard.press('Escape')
  await expect(goal).toHaveValue('1')
  await page.reload()
  await expect(panel(page).getByLabel('Coverage goal')).toHaveValue('0.9')
})

test('suggests spots across floors and keeps them when switching floors (D55)', async ({
  page,
}) => {
  await openEditor(page)
  const floors = page.getByRole('navigation', { name: 'Floors' })
  await floors.getByRole('button', { name: '+ Floor above' }).click()
  // Close an upper floor over the sample home's front 8 m.
  await page.keyboard.press('w')
  for (const [x, y] of [
    [0, 0],
    [15, 0],
    [15, 8],
    [0, 8],
    [0, 0],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  // Over a concrete slab, the router downstairs doesn't reach it.
  await panel(page)
    .getByLabel('Floor construction')
    .selectOption('concrete-slab')
  await panel(page).getByLabel('Coverage target').selectOption('excellent')

  await panel(page)
    .getByRole('button', { name: 'Suggest one more access point' })
    .click()
  // The router stays downstairs; the new one goes upstairs.
  await expect(optimizerStatus(page)).toContainText(
    /^Move Router to .* on Main floor and add Access point 1 at .* on Upper floor: \d+% → \d+% of the home at Excellent or better on 5 GHz\.$/,
  )
  const byFloor = panel(page).getByRole('list', { name: 'By floor' })
  await expect(byFloor.getByRole('listitem')).toHaveText([
    /^Upper floor: 0% → \d+%$/,
    /^Main floor: 83% → \d+%$/,
  ])
  await expect(
    floors.getByRole('button', { name: /^Upper floor.*suggested spots$/ }),
  ).toBeVisible()

  // Switching floors keeps the suggestion, and shows that floor's spots.
  await floors.getByRole('button', { name: /^Main floor/ }).click()
  await expect(coverageStatus(page)).toHaveText(
    /^With the suggestion: Main floor: /,
  )
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await floors.getByRole('button', { name: /^Upper floor/ }).click()
  await expect(coverageStatus(page)).toHaveText(/^Upper floor: \d+% of 120 m²/)
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Apply the suggested spots/,
  )
})
