import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const notice = (page: Page) => page.locator('.status-notice')

const ROUTER_5 = 'a4:2b:b0:12:34:56'
const NEXT_DOOR = 'f0:9f:c2:00:00:01'

/** Clicks a button that opens the file picker, and picks a made-up file. */
async function importFile(
  page: Page,
  button: string | RegExp,
  name: string,
  text: string,
) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: button }).click()
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text),
  })
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('imports readings, mapping unknown BSSIDs once (D72)', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await clickPlan(page, 3, 4)
  await expect(
    panel(page).getByRole('heading', { name: 'Spot 1' }),
  ).toBeVisible()

  // Two scans of the router's 5 GHz radio, and a neighbour: rows without a
  // spot go to the selected one.
  await importFile(
    page,
    'Import readings…',
    'scan.csv',
    [
      'SSID,BSSID,RSSI,Channel',
      `Home,${ROUTER_5.toUpperCase()},-60,36`,
      `Home,${ROUTER_5},-70,36`,
      `Next door,${NEXT_DOOR},-80,6`,
    ].join('\n'),
  )
  const dialog = page.getByRole('dialog', {
    name: 'Which radio is each BSSID?',
  })
  await expect(dialog).toBeVisible()
  const importButton = dialog.getByRole('button', { name: 'Import' })
  await expect(importButton).toBeDisabled()
  await dialog
    .getByRole('combobox', { name: new RegExp(ROUTER_5) })
    .selectOption({ label: 'Wi-Fi 6E router, 5 GHz' })
  await dialog.getByRole('button', { name: 'Mark the rest not mine' }).click()
  await expect(
    dialog.getByRole('combobox', { name: new RegExp(NEXT_DOOR) }),
  ).toHaveValue('not-mine')
  await importButton.click()
  await expect(dialog).toBeHidden()

  // −60 and −70 dBm average in mW to −62.6 dBm.
  await expect(
    panel(page).getByRole('group', { name: 'Wi-Fi 6E router, 5 GHz' }),
  ).toBeVisible()
  await expect(
    panel(page).getByRole('textbox', { name: /Signal \(dBm\)/ }),
  ).toHaveValue('-62.6')
  await expect(notice(page)).toHaveText(
    'Imported 1 reading, skipped 1 row from networks marked not mine.',
  )
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Import readings/,
  )

  // The mapping was saved: the next file, with positions, needs no dialog.
  await importFile(
    page,
    'Import readings…',
    'second.csv',
    ['bssid,dbm,x,y', `${ROUTER_5},-66,8,5`, `${NEXT_DOOR},-81,8,5`].join('\n'),
  )
  await expect(notice(page)).toHaveText(
    'Imported 1 reading, added 1 spot, skipped 1 row from networks marked not mine.',
  )
  await expect(dialog).toBeHidden()

  // Undo takes back the second import, then the first with its mapping.
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('v')
  await clickPlan(page, 5.6, 1.2)
  await expect(
    panel(page).getByRole('textbox', { name: '5 GHz BSSIDs' }),
  ).toHaveValue('')
})

test('says what’s wrong with a bad file and imports nothing (D72)', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await importFile(
    page,
    'Import readings…',
    'bad.csv',
    ['bssid,dbm,x,y', `${ROUTER_5},-60,1,1`, 'not-a-bssid,-60,1,1'].join('\n'),
  )
  const dialog = page.getByRole('dialog', {
    name: 'These readings can’t be imported',
  })
  await expect(dialog).toContainText('line 3')
  await expect(dialog).toContainText('isn’t a BSSID')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(panel(page)).toContainText('No spots yet on any floor.')
})

test('refuses a file in millimetres, saying so, and imports nothing', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await importFile(
    page,
    'Import readings…',
    'millimetres.csv',
    [
      'BSSID,RSSI,x,y',
      `${ROUTER_5},-50,2500,3100`,
      `${ROUTER_5},-60,7500,3100`,
    ].join('\n'),
  )
  const dialog = page.getByRole('dialog', {
    name: 'These readings can’t be imported',
  })
  await expect(dialog).toContainText('line 2')
  await expect(dialog).toContainText('line 3')
  await expect(dialog).toContainText(
    /Position 2500, 3100 is [\d.]+ km outside the walls\. Was the file saved in millimetres or centimetres\?/,
  )
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(panel(page)).toContainText('No spots yet on any floor.')
})

test('an undo in the mapping dialog leaves the plan behind it alone', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await clickPlan(page, 3, 4)
  await importFile(
    page,
    'Import readings…',
    'scan.csv',
    ['bssid,dbm', `${ROUTER_5},-60`].join('\n'),
  )
  const dialog = page.getByRole('dialog', {
    name: 'Which radio is each BSSID?',
  })
  await dialog
    .getByRole('combobox', { name: new RegExp(ROUTER_5) })
    .selectOption({ label: 'Wi-Fi 6E router, 5 GHz' })
  // Keys in a dialog are the dialog's: undo doesn't remove the spot the rows
  // are going to, so the import goes through.
  await dialog.getByRole('button', { name: 'Cancel' }).focus()
  await page.keyboard.press('ControlOrMeta+z')
  await dialog.getByRole('button', { name: 'Import' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('dialog', { name: 'These readings can’t be imported' }),
  ).toBeHidden()
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Undo Import/,
  )
})
