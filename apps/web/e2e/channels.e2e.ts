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

test.describe('channel and width per radio', () => {
  test.use({ locale: 'en-US' })

  const width = (page: Page) => panel(page).getByLabel('5 GHz width')
  const channel = (page: Page) => panel(page).getByLabel('5 GHz channel')

  test('sets a width, then a channel, each undoable', async ({ page }) => {
    await openEditor(page)
    await page.keyboard.press('a')
    await clickPlan(page, 3, 2)
    await expect(channel(page)).toBeDisabled()
    await width(page).selectOption({ label: '80 MHz' })
    await expect(channel(page)).toBeEnabled()
    // With DFS off, 58 (5250–5330 MHz) isn't offered; 42 is.
    await expect(channel(page).locator('option')).toHaveText([
      'Auto',
      '42 (5210 MHz)',
      '155 (5775 MHz)',
    ])
    await channel(page).selectOption({ label: '42 (5210 MHz)' })
    await expect(channel(page)).toHaveValue('42')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(channel(page)).toHaveValue('')
    await expect(width(page)).toHaveValue('80')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(width(page)).toHaveValue('')
    await expect(channel(page)).toBeDisabled()
  })

  test('flags a DFS channel when DFS is turned off', async ({ page }) => {
    await openEditor(page)
    await dfs(page).check()
    await page.keyboard.press('a')
    await clickPlan(page, 3, 2)
    await width(page).selectOption({ label: '20 MHz' })
    await channel(page).selectOption({ label: '52 (5260 MHz, DFS)' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await dfs(page).uncheck()
    const flagged = panel(page).getByRole('button', {
      name: 'Access point 1, 5 GHz',
    })
    await expect(flagged).toBeVisible()
    await flagged.click()
    // Still on 52, marked, with a note saying why.
    await expect(channel(page)).toHaveValue('52')
    await expect(channel(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(panel(page).getByText('is a DFS channel')).toBeVisible()
  })

  test('flags a channel the new region lacks', async ({ page }) => {
    await openEditor(page)
    await page.keyboard.press('a')
    await clickPlan(page, 3, 2)
    await width(page).selectOption({ label: '20 MHz' })
    await channel(page).selectOption({ label: '149 (5745 MHz)' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await region(page).selectOption({ label: 'European Union' })
    await expect(panel(page).getByText('One radio has a channel')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(panel(page).getByText('One radio has a channel')).toBeHidden()
  })
})

test.describe('in a German browser', () => {
  test.use({ locale: 'de-DE' })

  test('starts the sample on EU rules', async ({ page }) => {
    await openEditor(page)
    await expect(region(page)).toHaveValue('EU')
  })
})
