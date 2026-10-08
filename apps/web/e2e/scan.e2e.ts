import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const notice = (page: Page) => page.locator('.status-notice')
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })

/** Windows' netsh output: signal in %, no widths (written by hand, D79). */
const NETSH = `
Interface name : Wi-Fi
There are 2 networks currently visible.

SSID 1 : HomeNet
    Network type            : Infrastructure
    BSSID 1                 : a4:2b:b0:12:34:56
         Signal             : 86%
         Band               : 5 GHz
         Channel            : 36
    BSSID 2                 : a4:2b:b0:12:34:55
         Signal             : 100%
         Band               : 2.4 GHz
         Channel            : 6

SSID 2 : Next door
    Network type            : Infrastructure
    BSSID 1                 : 10:20:30:40:50:60
         Signal             : 30%
         Channel            : 149
`

/** The same networks from SignalPlan's own scan format, with widths. */
const SCRIPT = JSON.stringify({
  signalplanScan: 1,
  networks: [
    {
      bssid: 'a4:2b:b0:12:34:56',
      ssid: 'HomeNet',
      frequencyMHz: 5180,
      widthMHz: 80,
      dbm: -56,
    },
    {
      bssid: '10:20:30:40:50:60',
      ssid: 'Next door',
      frequencyMHz: 5745,
      widthMHz: 40,
      dbm: -80,
    },
  ],
})

async function readScan(page: Page, output: string) {
  await page.getByText('File', { exact: true }).click()
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Scan your network…' })
    .click()
  const reader = dialog(page, 'Scan your network')
  await expect(reader).toBeVisible()
  await reader.getByRole('textbox', { name: 'What it printed' }).fill(output)
  await reader.getByRole('button', { name: 'Read scan' }).click()
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('imports a scan: your radios’ BSSIDs, and a neighbour’s network (D80)', async ({
  page,
}) => {
  await readScan(page, NETSH)
  const answers = dialog(page, 'Which networks are yours?')
  await expect(answers).toContainText('Read 3 BSSIDs from Windows (netsh)')
  const apply = answers.getByRole('button', { name: 'Apply' })
  await expect(apply).toBeDisabled()
  // The router's two BSSIDs are one device: Mine, then which access point.
  await answers
    .getByRole('group', { name: /HomeNet/ })
    .getByText('Mine', { exact: true })
    .click()
  await expect(apply).toBeDisabled()
  await answers
    .getByRole('combobox', { name: /Which access point\? \(HomeNet/ })
    .selectOption({ label: 'Router' })
  await answers
    .getByRole('button', { name: 'Mark the rest a neighbour’s' })
    .click()
  await expect(answers).toContainText('the band’s usual width')
  await expect(answers).toContainText('approximate')
  await apply.click()
  await expect(answers).toBeHidden()
  await expect(notice(page)).toHaveText(
    'Scan imported: matched 2 BSSIDs to radios, added 1 neighbour’s network.',
  )
  await expect(
    panel(page).getByRole('textbox', { name: 'Next door, 5 GHz Name' }),
  ).toHaveValue('Next door')
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Import scan/,
  )

  // A later scan with widths knows every BSSID: it sets the router's
  // channel, on Auto until now, and updates the neighbour in place.
  await readScan(page, SCRIPT)
  await expect(answers).toContainText('2 of them already known')
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(notice(page)).toHaveText(
    'Scan imported: set 1 radio’s channel, updated 1.',
  )
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await expect(panel(page).getByLabel('5 GHz channel')).toHaveValue('42')
  await expect(panel(page).getByLabel('5 GHz width')).toHaveValue('80')
})

test('adds your router from a scan when the plan doesn’t have it (D105)', async ({
  page,
}) => {
  // The sample's router deleted, as if starting on your own home.
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Delete')
  await expect(panel(page).locator('.access-points-empty')).toBeVisible()

  await readScan(page, NETSH)
  const answers = dialog(page, 'Which networks are yours?')
  // With no access points, Mine is a new one straight away.
  await answers
    .getByRole('group', { name: /HomeNet/ })
    .getByText('Mine', { exact: true })
    .click()
  await expect(
    answers.getByRole('combobox', { name: /Which access point\? \(HomeNet/ }),
  ).toHaveValue('new')
  await expect(answers).toContainText('Adds an access point')
  await expect(answers).toContainText('HomeNet (2.4 GHz and 5 GHz)')
  await answers
    .getByRole('button', { name: 'Mark the rest a neighbour’s' })
    .click()
  await answers.getByRole('button', { name: 'Apply' }).click()
  await expect(answers).toBeHidden()
  await expect(notice(page)).toHaveText(
    'Scan imported: added HomeNet, matched 2 BSSIDs to radios, added 1 neighbour’s network. Drag it to where it is.',
  )

  // Selected, in the middle of the floor, on the two bands it was heard on.
  await expect(
    panel(page).getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveValue('HomeNet')
  await expect(panel(page)).toContainText('7.50 m, 5.00 m')
  await expect(
    panel(page).getByRole('checkbox', { name: '2.4 GHz', exact: true }),
  ).toBeChecked()
  await expect(
    panel(page).getByRole('checkbox', { name: '5 GHz', exact: true }),
  ).toBeChecked()
  await expect(
    panel(page).getByRole('checkbox', { name: '6 GHz', exact: true }),
  ).not.toBeChecked()
  await expect(
    panel(page).getByRole('textbox', { name: '5 GHz BSSIDs' }),
  ).toHaveValue('a4:2b:b0:12:34:56')

  // One undo step takes the access point and the neighbour away together.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(panel(page).locator('.access-points-empty')).toBeVisible()
  await expect(
    panel(page).getByRole('textbox', { name: 'Next door, 5 GHz Name' }),
  ).toBeHidden()
})

test('a card per device, answered with buttons, split inside its card (D106)', async ({
  page,
}) => {
  await readScan(page, NETSH)
  const answers = dialog(page, 'Which networks are yours?')
  const status = answers.locator('.dialog-status')
  await expect(status).toHaveText('0 of 2 devices answered')
  const home = answers.locator('.scan-device').filter({ hasText: 'HomeNet' })
  await expect(home.getByRole('heading', { name: 'HomeNet' })).toBeVisible()
  await expect(home).toContainText('2 networks')

  // Split: each network gets its own answer inside the card.
  const toggle = home.getByRole('button', {
    name: 'Answer each network separately (2)',
  })
  await toggle.click()
  const networks = home.locator('.scan-network')
  await expect(networks).toHaveCount(2)
  await expect(
    home.getByRole('button', { name: 'Answer as one device' }),
  ).toHaveAttribute('aria-expanded', 'true')
  await networks.nth(0).getByText('Mine', { exact: true }).click()
  await networks
    .nth(0)
    .getByRole('combobox', { name: /Which access point/ })
    .selectOption({ label: 'Router' })
  await networks.nth(1).getByText('Ignore', { exact: true }).click()
  await expect(status).toHaveText('1 of 2 devices answered')

  // The rest become a neighbour's; the Apply button turns on.
  await answers
    .getByRole('button', { name: 'Mark the rest a neighbour’s' })
    .click()
  await expect(status).toHaveText('2 of 2 devices answered')
  await answers.getByRole('button', { name: 'Apply' }).click()
  await expect(notice(page)).toHaveText(
    'Scan imported: matched 1 BSSID to radios, added 1 neighbour’s network, ignored 1 BSSID.',
  )
})

test('says what’s wrong with output it can’t read (D80)', async ({ page }) => {
  await readScan(page, 'hello')
  const reader = dialog(page, 'Scan your network')
  await expect(reader.getByRole('alert')).toContainText(
    'isn’t a scan SignalPlan can read',
  )
  await reader.getByRole('button', { name: 'Cancel' }).click()
  await expect(reader).toBeHidden()
})
