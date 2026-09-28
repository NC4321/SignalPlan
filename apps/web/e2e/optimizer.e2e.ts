import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const coverageStatus = (page: Page) => page.locator('.coverage-status')
const optimizerStatus = (page: Page) => panel(page).locator('.optimizer-status')
const find = (page: Page) =>
  panel(page).getByRole('button', {
    name: 'Find a better spot for Wi-Fi 6E router',
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
  await expect(optimizerStatus(page)).toContainText('Move Wi-Fi 6E router to')
  // The heatmap and status bar show coverage with the suggestion in place.
  await expect(coverageStatus(page)).toHaveText(
    /^With the suggestion: 92% of .* at Fair or better on 5 GHz\.$/,
  )
  await expect(panel(page)).toContainText('mesh backhaul isn’t modelled')

  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(coverageStatus(page)).toHaveText(/^92% of/)
  await expect(
    panel(page).getByRole('heading', { name: 'Wi-Fi 6E router' }),
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
    'Searching for a spot for Wi-Fi 6E router…',
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

test('explains which access point to pick when there are several', async ({
  page,
}) => {
  await openEditor(page)
  await page.keyboard.press('a')
  await page.locator('.editor-canvas').click({ position: { x: 40, y: 40 } })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toContainText(
    'Select the access point to move; the others stay where they are.',
  )
  await expect(panel(page).getByRole('button', { name: /^Find/ })).toHaveCount(
    0,
  )
})

test('adds an access point to a floor without one', async ({ page }) => {
  await openEditor(page)
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await panel(page)
    .getByRole('button', { name: 'Find the best spot for an access point' })
    .click()
  await expect(optimizerStatus(page)).toContainText('Add Access point 1 to')
  await expect(optimizerStatus(page)).toContainText('0% →')
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(
    panel(page).getByRole('heading', { name: 'Access point 1' }),
  ).toBeVisible()
})
