import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const show = (page: Page) => page.getByLabel('Show', { exact: true })
const summary = (page: Page) => page.locator('.status-bar .coverage-status')

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('switches between Signal, Overlap and Roaming (D64)', async ({ page }) => {
  await expect(show(page)).toHaveValue('signal')
  await expect(
    panel(page).getByRole('heading', { name: 'Signal quality' }),
  ).toBeVisible()
  await expect(summary(page)).toContainText('at Fair or better on 5 GHz')

  await show(page).selectOption({ label: 'Overlap' })
  await expect(
    panel(page).getByRole('heading', { name: 'Overlap' }),
  ).toBeVisible()
  // The sample has one access point, so nothing competes.
  await expect(summary(page)).toContainText(
    '0% of 150 m² has two or more access points competing on 5 GHz.',
  )

  await show(page).selectOption({ label: 'Roaming' })
  await expect(
    panel(page).getByRole('heading', { name: 'Roaming' }),
  ).toBeVisible()
  await expect(
    panel(page).locator('.legend').getByText('Wi-Fi 6E router'),
  ).toBeVisible()
  await expect(summary(page)).toContainText('is a gap below -70 dBm on 5 GHz.')
})

test('changes the roaming threshold as an undoable plan setting', async ({
  page,
}) => {
  await show(page).selectOption({ label: 'Roaming' })
  await panel(page).getByText('Overlap and roaming').click()
  const threshold = panel(page).getByLabel('Roaming threshold (dBm)')
  await expect(threshold).toHaveAttribute('placeholder', '-70 (default)')

  await threshold.fill('-95')
  await threshold.press('Enter')
  await expect(panel(page).getByRole('alert')).toContainText(
    'Use a number from -90 to -50',
  )
  await threshold.fill('-80')
  await threshold.press('Enter')
  await expect(summary(page)).toContainText('is a gap below -80 dBm')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(summary(page)).toContainText('is a gap below -70 dBm')
  await expect(threshold).toHaveValue('')
})

test('exports the map on show', async ({ page }) => {
  await show(page).selectOption({ label: 'Roaming' })
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'Export image…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export image' })
  await expect(dialog).toContainText('5 GHz roaming map')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export PNG' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(
    'Sample bungalow - 5 GHz roaming.png',
  )
})

test('the 3D view follows the map on show', async ({ page }) => {
  await show(page).selectOption({ label: 'Overlap' })
  await page
    .getByRole('group', { name: 'View' })
    .locator('label', { hasText: '3D' })
    .click()
  await expect(
    page.getByRole('list', { name: 'Floors in the 3D view' }),
  ).toContainText('has two or more access points competing')
})

test('shows signal to interference and noise (D66)', async ({ page }) => {
  await show(page).selectOption({ label: 'Interference' })
  const legend = panel(page)
  await expect(
    legend.getByRole('heading', { name: 'Signal to interference and noise' }),
  ).toBeVisible()
  await expect(legend.locator('.legend')).toContainText('≥ 39 dB')
  // The sample's one access point leaves its channel on Auto.
  await expect(legend.locator('.legend-note')).toContainText(
    '1 access point has its channel on Auto',
  )
  await expect(summary(page)).toContainText(
    'is too noisy for any rate (below 9 dB) on 5 GHz.',
  )
})

test('a neighbour’s network adds interference (D67)', async ({ page }) => {
  const noisy = async () =>
    Number(/^(\d+)%/.exec(await summary(page).innerText())![1])
  // Put the sample's router on channel 42 at 80 MHz.
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await panel(page).getByLabel('5 GHz width').selectOption({ label: '80 MHz' })
  await panel(page).getByLabel('5 GHz channel').selectOption('42')
  await page.keyboard.press('Escape')
  await show(page).selectOption({ label: 'Interference' })
  await expect(summary(page)).toContainText('too noisy for any rate')
  const alone = await noisy()

  await panel(page).getByRole('button', { name: 'Add a network' }).click()
  const row = panel(page).getByRole('group', { name: 'Network 1' })
  await expect(
    row.getByText('Pick a channel to count this network.'),
  ).toBeVisible()
  // The usual 5 GHz width, and a channel still to pick.
  await expect(row.getByLabel('Width')).toHaveValue('80')
  await expect(row.getByLabel('Channel')).toHaveValue('')
  await row.getByLabel('Name').fill('Next door')
  await row.getByLabel('Name').press('Enter')
  const named = panel(page).getByRole('group', { name: 'Next door' })
  await named.getByLabel('Channel').selectOption('42')
  const strength = named.getByLabel('Signal (dBm)')
  await strength.fill('-50')
  await strength.press('Enter')
  await expect(panel(page).locator('.legend-note')).toContainText(
    '1 neighbour’s network counts everywhere',
  )
  await expect.poll(noisy).toBeGreaterThan(alone)

  // Out of range is refused; removing it is one undo step.
  await strength.fill('-5')
  await strength.press('Enter')
  await expect(named.getByRole('alert')).toContainText('from -100 to -20.')
  await strength.press('Escape')
  await named.getByRole('button', { name: 'Remove Next door' }).click()
  await expect(named).toBeHidden()
  await expect.poll(noisy).toBe(alone)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(named.getByLabel('Signal (dBm)')).toHaveValue('-50')
})
