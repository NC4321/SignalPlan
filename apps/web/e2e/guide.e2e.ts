import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

// A first visit: nothing in this browser yet.
test.use({ storageState: { cookies: [], origins: [] } })

const guide = (page: Page) =>
  page.getByRole('region', { name: /Your Wi-Fi|Move an|Draw a wall|Plan your/ })

test('a first visit is guided through the sample home, once', async ({
  page,
}) => {
  await openEditor(page)
  await expect(guide(page)).toContainText('Step 1 of 4')
  await expect(guide(page)).toContainText('Your Wi-Fi, predicted')
  const axe = await new AxeBuilder({ page }).analyze()
  expect(
    axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact!)),
  ).toEqual([])
  await guide(page).getByRole('button', { name: 'Next' }).click()

  // Moving the router moves the guide on.
  await expect(guide(page)).toContainText('Move an access point')
  await page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('ArrowRight')
  await expect(guide(page)).toContainText('Step 3 of 4')

  // Drawing a wall moves it on, with the Wall tool ringed meanwhile.
  const wallTool = page.locator('.toolbar [aria-keyshortcuts="W"]')
  await expect(wallTool).toHaveClass(/guide-target/)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.keyboard.press('w')
  await clickPlan(page, 17, 2)
  await clickPlan(page, 19, 2)
  await page.keyboard.press('Enter')
  await expect(guide(page)).toContainText('Plan your own home')
  await expect(wallTool).not.toHaveClass(/guide-target/)
  await expect(page.locator('[data-guide="file-menu"]')).toHaveClass(
    /guide-target/,
  )
  await guide(page).getByRole('button', { name: 'Done' }).click()
  await expect(guide(page)).toBeHidden()

  // Seen once, it doesn't come back on the next visit.
  await page.reload()
  await openEditor(page)
  await expect(guide(page)).toBeHidden()
})

test('Skip ends the guide, and ? brings it back', async ({ page }) => {
  await openEditor(page)
  await guide(page).getByRole('button', { name: 'Skip the guide' }).click()
  await expect(guide(page)).toBeHidden()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await dialog.getByRole('button', { name: 'Show the guide again' }).click()
  await expect(dialog).toBeHidden()
  await expect(guide(page)).toContainText('Step 1 of 4')
})
