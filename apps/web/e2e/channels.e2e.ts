import { fileURLToPath } from 'node:url'
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

test.describe('flagged radios on another floor', () => {
  test.use({ locale: 'en-US' })

  test('the Channels list goes to the floor and selects the access point', async ({
    page,
  }) => {
    await openEditor(page)
    const stack = page.getByRole('navigation', { name: 'Floors' })
    await stack.getByRole('button', { name: '+ Floor above' }).click()
    await page.keyboard.press('a')
    await clickPlan(page, 3, 2)
    await panel(page)
      .getByLabel('5 GHz width')
      .selectOption({ label: '20 MHz' })
    await panel(page)
      .getByLabel('5 GHz channel')
      .selectOption({ label: '149 (5745 MHz)' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await stack.getByRole('button', { name: 'Main floor' }).click()

    await region(page).selectOption({ label: 'European Union' })
    await panel(page)
      .getByRole('button', { name: 'Access point 1, 5 GHz (Upper floor)' })
      .click()
    await expect(
      stack.getByRole('button', { name: 'Upper floor' }),
    ).toHaveAttribute('aria-current', 'true')
    await expect(
      panel(page).getByRole('heading', { name: 'Access point 1' }),
    ).toBeVisible()
    await expect(panel(page).getByLabel('5 GHz channel')).toHaveValue('149')
  })
})

test.describe('in a German browser', () => {
  test.use({ locale: 'de-DE' })

  test('starts the sample on EU rules', async ({ page }) => {
    await openEditor(page)
    await expect(region(page)).toHaveValue('EU')
  })
})

test.describe('channel planner (D68)', () => {
  test.use({ locale: 'en-US' })

  test('suggests channels with reasons, applies as one undo step', async ({
    page,
  }) => {
    await openEditor(page)
    // A second access point beside the sample's router.
    await page.keyboard.press('a')
    await clickPlan(page, 3, 2)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page
      .getByLabel('Show', { exact: true })
      .selectOption({ label: 'Interference' })
    await expect(panel(page).locator('.legend-note')).toContainText(
      '2 access points have their channels on Auto',
    )

    await panel(page).getByRole('button', { name: 'Plan channels' }).click()
    const five = panel(page).getByRole('region', {
      name: '5 GHz channel plan',
    })
    await expect(five).toContainText(
      'No access points that hear each other share a channel on 5 GHz.',
    )
    await expect(five.getByRole('listitem')).toHaveCount(2)
    await expect(five.getByRole('listitem').first()).toContainText(
      'which it hears.',
    )
    await expect(
      panel(page).getByRole('region', { name: '2.4 GHz channel plan' }),
    ).toBeVisible()
    // The map previews the plan: no radio is on Auto any more.
    await expect(panel(page).locator('.legend-note')).not.toContainText(
      'on Auto',
    )

    await panel(page).getByRole('button', { name: 'Apply' }).click()
    await expect(five).toBeHidden()
    await panel(page)
      .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
      .click()
    await expect(panel(page).getByLabel('5 GHz channel')).not.toHaveValue('')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(panel(page).getByLabel('5 GHz channel')).toHaveValue('')
  })

  test('explains its plan for the three-AP home (exit gate, D69)', async ({
    page,
  }) => {
    await openEditor(page)
    await page
      .getByLabel('Open a plan file')
      .setInputFiles(
        fileURLToPath(
          new URL(
            '../../../packages/floorplan/fixtures/three-ap-home.json',
            import.meta.url,
          ),
        ),
      )
    await expect(
      panel(page).getByRole('heading', { level: 2 }).first(),
    ).toHaveText('Three-AP two-storey home')
    const plan = panel(page).getByRole('button', { name: 'Plan channels' })
    const five = panel(page).getByRole('region', {
      name: '5 GHz channel plan',
    })

    // Without DFS, 80 MHz has only two channels for three access points.
    await plan.click()
    await expect(five).toContainText(
      'No access points that hear each other share a channel on 5 GHz.',
    )
    await expect(five).toContainText('Narrowed from 80 to 40 MHz')
    await expect(five).toContainText('Allowing DFS channels would keep 80 MHz.')
    await panel(page).getByRole('button', { name: 'Dismiss' }).click()

    await dfs(page).check()
    await plan.click()
    await expect(five).toContainText(
      'Bedroom 2 mesh point and Upstairs mesh point are on DFS channels: without DFS channels, the plan would narrow to 40 MHz.',
    )
    const radios = five.getByRole('listitem')
    await expect(radios).toHaveText([
      /^Wi-Fi 6E router: 155 \(5775 MHz\) at 80 MHz Apart from Bedroom 2 mesh point and Upstairs mesh point, which it hears; clear of Next door\.$/,
      /^Bedroom 2 mesh point: 58 \(5290 MHz, DFS\) at 80 MHz Apart from Wi-Fi 6E router and Upstairs mesh point, which it hears; clear of Next door\.$/,
      /^Upstairs mesh point: 106 \(5530 MHz, DFS\) at 80 MHz Apart from Wi-Fi 6E router and Bedroom 2 mesh point, which it hears; clear of Next door\.$/,
    ])
  })

  test('dismisses, and any change drops the suggestion', async ({ page }) => {
    await openEditor(page)
    const plan = panel(page).getByRole('button', { name: 'Plan channels' })
    await plan.click()
    await panel(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(plan).toBeVisible()
    await plan.click()
    await dfs(page).check()
    await expect(plan).toBeVisible()
    await expect(page.locator('.status-bar')).toContainText(
      'Channel plan dismissed: the plan changed.',
    )
  })
})
