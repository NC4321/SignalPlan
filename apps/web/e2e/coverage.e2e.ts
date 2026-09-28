import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const share = (page: Page) => panel(page).locator('.coverage-share')
const target = (page: Page) => panel(page).getByLabel('Coverage target')

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('shows the share of the sample home at the target, per band', async ({
  page,
}) => {
  // The sample home's walls enclose its stated 150 m².
  await expect(share(page)).toHaveText(
    '86% of 150 m² at Fair or better on 5 GHz.',
  )
  await page.getByText('6 GHz', { exact: true }).click()
  await expect(share(page)).toHaveText(
    '86% of 150 m² at Fair or better on 6 GHz.',
  )

  await target(page).selectOption('excellent')
  await expect(share(page)).toHaveText(
    '65% of 150 m² at Excellent or better on 6 GHz.',
  )
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Undo Change coverage target/,
  )
  await page.keyboard.press('ControlOrMeta+z')
  await expect(target(page)).toHaveValue('fair')

  await page.getByText('Imperial', { exact: true }).click()
  await expect(share(page)).toContainText('of 1,615 sq ft')
})

test('asks for a closed outline, then counts the room inside it', async ({
  page,
}) => {
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await expect(share(page)).toHaveText(
    'Close the outer walls to see how much of the floor is covered.',
  )

  await page.keyboard.press('w')
  for (const [x, y] of [
    [4, 2],
    [8, 2],
    [8, 5],
    [4, 5],
    [4, 2],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')
  await expect(share(page)).toHaveText(
    /^\d+% of 12 m² at Fair or better on 5 GHz\.$/,
  )
})

test('shows no share while nothing broadcasts on the band', async ({
  page,
}) => {
  await panel(page).getByRole('button', { name: 'Router' }).click()
  await page.keyboard.press('Delete')
  await expect(share(page)).toBeHidden()
})
