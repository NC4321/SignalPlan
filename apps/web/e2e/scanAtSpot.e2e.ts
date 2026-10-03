import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const notice = (page: Page) => page.locator('.status-notice')
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })

interface Spot {
  id: string
  x: number
  y: number
  readings: { apId: string; band: string; dbm: number }[]
}

/** The sample bungalow with 11 spots read from its router on every band. */
const surveyed = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../packages/floorplan/fixtures/surveyed-home.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
)
const SPOTS: Spot[] = surveyed.floors[0].surveySpots

/** The router's BSSID on each band, and a neighbour's. */
const BSSID: Record<string, string> = {
  '2.4GHz': 'a4:2b:b0:12:34:51',
  '5GHz': 'a4:2b:b0:12:34:52',
  '6GHz': 'a4:2b:b0:12:34:53',
}
const NEIGHBOUR = '10:20:30:40:50:60'
const SCAN_BAND: Record<string, { band: string; channel: number }> = {
  '2.4GHz': { band: '2.4', channel: 6 },
  '5GHz': { band: '5', channel: 36 },
  '6GHz': { band: '6', channel: 37 },
}

/**
 * The surveyed home with the router's BSSIDs known, and without its spots,
 * for scans to put back.
 */
function withoutSpots() {
  const plan = structuredClone(surveyed)
  for (const radio of plan.accessPoints[0].radios) {
    radio.bssids = [BSSID[radio.band]]
  }
  delete plan.floors[0].surveySpots
  return plan
}

/** What SignalPlan's scan script would print at a spot (D81). */
function scanAt(spot: Spot, neighbourDbm: number) {
  return JSON.stringify({
    signalplanScan: 1,
    networks: [
      ...spot.readings.map((r) => ({
        bssid: BSSID[r.band],
        ssid: 'HomeNet',
        ...SCAN_BAND[r.band],
        dbm: r.dbm,
      })),
      {
        bssid: NEIGHBOUR,
        ssid: 'Next door',
        band: '5',
        channel: 149,
        dbm: neighbourDbm,
      },
    ],
  })
}

async function openPlan(page: Page, plan: unknown) {
  await page.getByLabel('Open a plan file').setInputFiles({
    name: 'surveyed-home.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan)),
  })
  await expect(
    panel(page).getByRole('heading', { level: 2 }).first(),
  ).toHaveText('Surveyed bungalow')
}

async function readScan(page: Page, output: string) {
  await page.getByText('File', { exact: true }).click()
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Scan your network…' })
    .click()
  const reader = dialog(page, 'Scan your network')
  await reader.getByRole('textbox', { name: 'What it printed' }).fill(output)
  await reader.getByRole('button', { name: 'Read scan' }).click()
  return dialog(page, 'Which networks are yours?')
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('scans placed on the plan become readings that Calibrate fits (D82)', async ({
  page,
}) => {
  await openPlan(page, withoutSpots())
  for (const [i, spot] of SPOTS.entries()) {
    // The neighbour is loudest at the fourth spot.
    const answers = await readScan(page, scanAt(spot, i === 3 ? -61 : -75))
    if (i === 0) {
      await answers
        .getByRole('combobox', { name: /Next door/ })
        .selectOption({ label: 'A neighbour’s' })
    }
    await answers
      .getByRole('radio', { name: /click the plan after Apply/ })
      .check()
    await answers.getByRole('button', { name: 'Apply, then click…' }).click()
    await expect(
      page.getByRole('region', { name: 'Place the scan' }),
    ).toBeVisible()
    await clickPlan(page, spot.x, spot.y)
    await expect(notice(page)).toContainText(
      `added Spot ${i + 1}, 3 readings at Spot ${i + 1}`,
    )
    await expect(
      panel(page).getByRole('heading', { name: `Spot ${i + 1}` }),
    ).toBeVisible()
  }
  await expect(
    page.getByRole('region', { name: 'Place the scan' }),
  ).toHaveCount(0)

  // The neighbour counts at the strongest it was heard.
  await page.keyboard.press('Escape')
  await expect(
    panel(page)
      .getByRole('group', { name: 'Next door, 5 GHz' })
      .getByLabel('Signal (dBm)'),
  ).toHaveValue('-61')

  // Calibrate fits every band from the scans, as from typed readings.
  await panel(page).getByRole('button', { name: 'Calibrate' }).click()
  await expect(
    panel(page).getByRole('region', { name: '5 GHz calibration' }),
  ).toContainText(/RMS error \d+\.\d → \d+\.\d dB/)
  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(panel(page)).toContainText(
    'Calibrated to this home’s survey on 2.4 GHz, 5 GHz and 6 GHz.',
  )
})

test('a scan at the selected spot averages in, and percentages show ≈ (D82)', async ({
  page,
}) => {
  const plan = withoutSpots()
  plan.floors[0].surveySpots = structuredClone(SPOTS)
  plan.ignoredBssids = [NEIGHBOUR]
  await openPlan(page, plan)
  await panel(page).getByRole('button', { name: 'Spot 1: 3 readings' }).click()
  await panel(page).getByRole('button', { name: 'Scan at this spot…' }).click()
  const reader = dialog(page, 'Scan your network')
  // netsh gives a percentage: 80 % is −60 dBm (D79).
  await reader.getByRole('textbox', { name: 'What it printed' }).fill(`
Interface name : Wi-Fi
There is 1 network currently visible.

SSID 1 : HomeNet
    Network type            : Infrastructure
    BSSID 1                 : ${BSSID['2.4GHz']}
         Signal             : 80%
         Band               : 2.4 GHz
         Channel            : 6
`)
  await reader.getByRole('button', { name: 'Read scan' }).click()
  const answers = dialog(page, 'Which networks are yours?')
  await expect(answers.getByRole('radio', { name: 'At Spot 1' })).toBeChecked()
  await answers.getByRole('button', { name: 'Apply' }).click()
  await expect(notice(page)).toContainText(
    '1 reading averaged with earlier scans',
  )

  const reading = panel(page).getByRole('group', {
    name: 'Wi-Fi 6E router, 2.4 GHz',
  })
  await expect(reading).toContainText(
    '≈ Approximate: converted from a signal percentage. The mean of 2 scans.',
  )
  // −39.3 and −60 dBm at mean power: 10·log10((10^−3.93 + 10^−6)/2).
  await expect(reading.getByLabel('Signal (dBm)')).toHaveValue('-42.3')

  // One undo step.
  await page.keyboard.press('Control+z')
  await expect(reading.getByLabel('Signal (dBm)')).toHaveValue('-39.3')
  await page.keyboard.press('Control+Shift+z')

  await page.keyboard.press('Escape')
  await expect(panel(page)).toContainText(
    '1 reading is approximate (≈): it was converted from a signal percentage',
  )
  await panel(page).getByRole('button', { name: 'Calibrate' }).click()
  await expect(
    panel(page).getByRole('region', { name: '2.4 GHz calibration' }),
  ).toContainText('1 of 11 readings are approximate (≈)')
})
