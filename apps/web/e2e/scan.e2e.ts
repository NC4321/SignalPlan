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
  // The router's two BSSIDs are one device.
  await answers
    .getByRole('combobox', { name: /HomeNet/ })
    .selectOption({ label: 'Mine: Wi-Fi 6E router' })
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
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await expect(panel(page).getByLabel('5 GHz channel')).toHaveValue('42')
  await expect(panel(page).getByLabel('5 GHz width')).toHaveValue('80')
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
