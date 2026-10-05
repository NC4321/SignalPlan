import { expect, test, type Page } from '@playwright/test'
import { clickPlan, expectNoSeriousViolations, openEditor } from './helpers.ts'

// Phase 9's exit gate (#163), automated: a stranger's whole first visit, from
// a fresh browser through the guide to a room of their own with coverage.
test.use({ storageState: { cookies: [], origins: [] } })

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const guide = (page: Page) =>
  page.getByRole('region', { name: /Your Wi-Fi|Move an|Draw a wall|Plan your/ })
const share = (page: Page) => panel(page).locator('.coverage-share')

test('a first visit follows the guide, then plans a room from scratch', async ({
  page,
}) => {
  await openEditor(page)
  await expect(guide(page)).toContainText('Your Wi-Fi, predicted')
  await expectNoSeriousViolations(page)
  await guide(page).getByRole('button', { name: 'Next' }).click()

  await expect(guide(page)).toContainText('Move an access point')
  await expectNoSeriousViolations(page)
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('ArrowRight')

  await expect(guide(page)).toContainText('Draw a wall')
  await expectNoSeriousViolations(page)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.keyboard.press('w')
  await clickPlan(page, 17, 2)
  await clickPlan(page, 19, 2)
  await page.keyboard.press('Enter')

  await expect(guide(page)).toContainText('Plan your own home')
  await expectNoSeriousViolations(page)
  await guide(page).getByRole('button', { name: 'Done' }).click()
  await expect(guide(page)).toBeHidden()

  // Their own home: a blank plan, its default access point removed, so the
  // room and the access point are both theirs.
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await page.keyboard.press('Escape')
  await panel(page).locator('.object-list').getByRole('button').first().click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toContainText('No walls on this floor yet.')
  await expect(panel(page)).toContainText('No access points on this floor yet.')
  await expectNoSeriousViolations(page)

  // A 5 × 4 m room.
  await page.keyboard.press('w')
  for (const [x, y] of [
    [2, 2],
    [7, 2],
    [7, 6],
    [2, 6],
    [2, 2],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')

  // An access point in the middle covers it.
  await page.keyboard.press('a')
  await clickPlan(page, 4.5, 4)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(share(page)).toHaveText(
    '100% of 20 m² at Fair or better on 5 GHz.',
  )
  await expectNoSeriousViolations(page)
})
