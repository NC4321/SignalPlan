import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  clickPlan,
  expectNoSeriousViolations,
  openEditor,
  summaryCount,
} from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const canvas = (page: Page) =>
  page.getByRole('application', { name: /^Floor plan/ })
const announcement = (page: Page) =>
  page.locator('[aria-live="polite"]').filter({ hasText: /./ }).last()

test('every part of the editor sits in a landmark', async ({ page }) => {
  await openEditor(page)
  const { violations } = await new AxeBuilder({ page })
    .withRules(['region'])
    .analyze()
  expect(violations.map((v) => v.nodes.map((n) => n.target))).toEqual([])
})

test.describe('axe-core finds no serious problems', () => {
  test('in the editor and properties panel', async ({ page }) => {
    await openEditor(page)
    await expectNoSeriousViolations(page)
    await canvas(page).focus()
    await page.keyboard.press('Tab')
    await expect(
      panel(page).getByRole('heading', { name: 'Wall', exact: true }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
    await page.keyboard.press('W')
    await expectNoSeriousViolations(page)
    await page.keyboard.press('A')
    await clickPlan(page, 3, 2)
    await expect(
      panel(page).getByRole('heading', { name: 'Access point 1' }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
  })

  test('in the optimizer panel with a suggestion (D44)', async ({ page }) => {
    await openEditor(page)
    await panel(page)
      .getByRole('button', { name: 'Find a better spot for Router' })
      .click()
    await expect(
      panel(page).getByRole('button', { name: 'Apply' }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
  })

  test('in the File menu and every dialog', async ({ page }) => {
    await openEditor(page)
    await page.getByText('File', { exact: true }).click()
    await expectNoSeriousViolations(page)

    await page.getByRole('button', { name: 'My plans…' }).click()
    const plans = page.getByRole('dialog', { name: 'My plans' })
    await expect(plans).toBeVisible()
    await expectNoSeriousViolations(page)
    await plans.getByRole('button', { name: 'Done' }).click()

    await page.getByText('File', { exact: true }).click()
    await page.getByRole('button', { name: 'Export image…' }).click()
    const exporter = page.getByRole('dialog', { name: 'Export image' })
    await expect(exporter).toBeVisible()
    await expectNoSeriousViolations(page)
    await exporter.getByRole('button', { name: 'Cancel' }).click()

    await page.getByText('File', { exact: true }).click()
    await page.getByRole('button', { name: 'Share link…' }).click()
    const share = page.getByRole('dialog', { name: 'Share link' })
    await expect(share.getByRole('textbox')).toHaveValue(/#plan=/)
    await expectNoSeriousViolations(page)
    await share.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(shortcuts).toBeVisible()
    await expectNoSeriousViolations(page)
    await shortcuts.getByRole('button', { name: 'Done' }).click()

    await page.getByText('File', { exact: true }).click()
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Scan your network…' })
      .click()
    const scan = page.getByRole('dialog', { name: 'Scan your network' })
    await expect(scan).toBeVisible()
    await expectNoSeriousViolations(page)
    await scan
      .getByRole('combobox', { name: 'Your device' })
      .selectOption('windows')
    await scan.getByText('Show the script').click()
    await expect(
      scan.getByRole('button', { name: 'Copy script' }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
    await scan
      .getByRole('textbox', { name: 'What it printed' })
      .fill('A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:86')
    await scan.getByRole('button', { name: 'Read scan' }).click()
    const answers = page.getByRole('dialog', {
      name: 'Which networks are yours?',
    })
    await expect(answers).toBeVisible()
    await expectNoSeriousViolations(page)
    await answers.getByRole('button', { name: 'Cancel' }).click()

    // Editing the sample puts it in the list, so it can be deleted.
    await panel(page)
      .getByRole('button', { name: 'Router', exact: true })
      .click()
    await canvas(page).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByText('File', { exact: true }).click()
    await page.getByRole('button', { name: 'My plans…' }).click()
    await plans.getByRole('button', { name: 'Delete Sample bungalow' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Delete “Sample bungalow”?' }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await page.getByLabel('Open a plan file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schemaVersion": 1}'),
    })
    await expect(
      page.getByRole('dialog', { name: 'This file can’t be opened' }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
  })
})

test('switches tools from the keyboard', async ({ page }) => {
  await openEditor(page)
  const tools = page.getByRole('toolbar', { name: 'Tools' })
  await page.keyboard.press('W')
  await expect(tools.getByRole('button', { name: 'Wall' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Tab reaches only the current tool; arrows move along; Space picks.
  await tools.getByRole('button', { name: 'Wall' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(tools.getByRole('button', { name: 'Door' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(tools.getByRole('button', { name: 'Door' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('End')
  await expect(tools.getByRole('button', { name: 'Survey' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(tools.getByRole('button', { name: 'Select' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(tools.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(tools.getByRole('button', { name: 'Select' })).toHaveAttribute(
    'tabindex',
    '0',
  )
  await expect(tools.getByRole('button', { name: 'Door' })).toHaveAttribute(
    'tabindex',
    '-1',
  )
})

test('opens the File menu and a dialog from the keyboard, and returns focus', async ({
  page,
}) => {
  await openEditor(page)
  const file = page.getByText('File', { exact: true })
  await file.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'New plan' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'My plans…' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(
    page.getByRole('button', { name: 'Open the sample home' }),
  ).toBeFocused()

  // Esc closes the menu, back on "File", without leaving the menu's owner.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'New plan' })).toBeHidden()
  await expect(file).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'My plans' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(file).toBeFocused()

  // Tabbing away closes the menu.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'New plan' })).toBeFocused()
  const items = await page.locator('.menu-items button').count()
  for (let i = 0; i < items; i++) await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'New plan' })).toBeHidden()
})

test('selects, deletes and restores plan items from the keyboard', async ({
  page,
}) => {
  await openEditor(page)
  const walls = await summaryCount(page, 'Walls')
  await canvas(page).focus()

  await page.keyboard.press('Tab')
  await expect(announcement(page)).toHaveText(
    /^Wall, \w[\w -]*, [\d.]+ m, 1 of \d+$/,
  )
  await expect(
    panel(page).getByRole('heading', { name: 'Wall', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(announcement(page)).toHaveText(/, 2 of \d+$/)
  await page.keyboard.press('Shift+Tab')
  await expect(announcement(page)).toHaveText(/, 1 of \d+$/)

  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  expect(await summaryCount(page, 'Walls')).toBeLessThan(walls)
  await page.keyboard.press('Control+Z')
  expect(await summaryCount(page, 'Walls')).toBe(walls)

  // Shift+Tab before the first item leaves the canvas.
  await canvas(page).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(canvas(page)).not.toBeFocused()
})

test('Shift+Tab from the canvas starts at the last item, an access point', async ({
  page,
}) => {
  await openEditor(page)
  await canvas(page).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(announcement(page)).toHaveText(
    /^Access point Router, at .*, (\d+) of \1$/,
  )
  await expect(
    panel(page).getByRole('heading', { name: 'Router' }),
  ).toBeVisible()
})
