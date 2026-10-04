import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

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

/**
 * The surveyed home with a neighbour's 5 GHz network heard by scans at
 * every spot, fading with distance from (−4, 4), west of the house.
 */
function withNeighbour() {
  const plan = structuredClone(surveyed)
  plan.neighbourNetworks = [
    {
      id: 'nn1',
      name: 'Smith',
      band: '5GHz',
      channel: 36,
      channelWidthMHz: 20,
      strengthDbm: -60,
      bssid: '10:20:30:40:50:60',
    },
  ]
  for (const spot of plan.floors[0].surveySpots) {
    const d = Math.hypot(spot.x + 4, spot.y - 4)
    spot.neighbourReadings = [
      {
        bssid: '10:20:30:40:50:60',
        band: '5GHz',
        dbm: Math.round((-38 - 20 * Math.log10(d)) * 10) / 10,
      },
    ]
  }
  return plan
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

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('locates a neighbour from its scans, and clears it again (D85)', async ({
  page,
}) => {
  await openPlan(page, withNeighbour())
  const row = panel(page).getByRole('group', { name: 'Smith, 5 GHz' })
  await expect(row).toContainText(
    'Heard by scans at 11 spots, enough to locate it.',
  )
  await row
    .getByRole('button', { name: 'Locate from scans Smith, 5 GHz' })
    .click()
  await expect(row).toContainText(
    /Located(, outside the walls)?, to within \d+ m/,
  )
  await expect(row).toContainText(
    'Its signal is predicted from there through walls and floors.',
  )

  // One edit, so undo takes it back.
  await page.keyboard.press('Control+z')
  await expect(row).toContainText('enough to locate it.')
  await page.keyboard.press('Control+Shift+z')
  await expect(row).toContainText(/Located/)

  await row.getByRole('button', { name: 'Clear location Smith, 5 GHz' }).click()
  await expect(row).toContainText('enough to locate it.')
})

test('checks where an access point is against its readings (D85)', async ({
  page,
}) => {
  const plan = structuredClone(surveyed)
  // Put the router 6 m east of where it was read from.
  plan.accessPoints[0].x += 6
  await openPlan(page, plan)
  await clickPlan(page, plan.accessPoints[0].x, plan.accessPoints[0].y)
  await expect(
    panel(page).getByRole('heading', { name: 'Wi-Fi 6E router' }),
  ).toBeVisible()
  await panel(page).getByRole('button', { name: 'Check its position' }).click()
  const status = panel(page).locator('.position-check')
  await expect(status).toContainText(
    /The readings put it about \d+ m from here, to within \d+ m\./,
  )
  await status.getByRole('button', { name: 'Move it there' }).click()
  await expect(status).toHaveCount(1)
  await expect(
    panel(page).getByRole('button', { name: 'Check its position' }),
  ).toBeVisible()

  // Checked again where it now is, the readings agree.
  await panel(page).getByRole('button', { name: 'Check its position' }).click()
  await expect(panel(page).locator('.position-check')).toContainText(
    'The readings agree with where it is',
  )
  await panel(page).getByRole('button', { name: 'OK' }).click()
})
