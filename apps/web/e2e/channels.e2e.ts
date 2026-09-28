import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const region = (page: Page) => panel(page).getByLabel('Region')
const dfs = (page: Page) =>
  panel(page).getByRole('checkbox', { name: 'Allow DFS channels' })

test.describe('in a US browser', () => {
  test.use({ locale: 'en-US' })

  test('switches region, and the power note follows it', async ({ page }) => {
    await openEditor(page)
    await expect(region(page)).toHaveValue('US')
    await region(page).selectOption({ label: 'European Union' })
    await expect(region(page)).toHaveValue('EU')

    await page.keyboard.press('a')
    await clickPlan(page, 3, 2)
    const power = panel(page).getByLabel('2.4 GHz power (dBm EIRP)')
    // 30 dBm is legal in the US but above the EU's 20 dBm.
    await power.fill('30')
    await power.press('Enter')
    await expect(panel(page).getByText('Above the legal limit')).toContainText(
      'in the EU',
    )
    await expect(panel(page).getByText('Above the legal limit')).toContainText(
      '20 dBm EIRP',
    )
  })

  test('allows DFS channels as an undoable edit', async ({ page }) => {
    await openEditor(page)
    await expect(dfs(page)).not.toBeChecked()
    await dfs(page).check()
    await expect(dfs(page)).toBeChecked()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(dfs(page)).not.toBeChecked()
  })
})

test.describe('in a German browser', () => {
  test.use({ locale: 'de-DE' })

  test('starts the sample on EU rules', async ({ page }) => {
    await openEditor(page)
    await expect(region(page)).toHaveValue('EU')
  })
})
