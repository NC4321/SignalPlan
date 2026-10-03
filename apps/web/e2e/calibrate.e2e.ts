import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openEditor, screenPoint } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const coverageStatus = (page: Page) => page.locator('.coverage-status')

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

/** The canvas colour `dx` px right of a plan point. */
async function canvasColour(page: Page, x: number, y: number, dx: number) {
  const canvas = page.locator('.editor-canvas')
  const box = (await canvas.boundingBox())!
  const at = await screenPoint(page, x, y)
  return canvas.evaluate(
    (el: HTMLCanvasElement, p) => {
      const ratio = el.width / el.getBoundingClientRect().width
      const data = el
        .getContext('2d')!
        .getImageData(
          Math.round(p.x * ratio),
          Math.round(p.y * ratio),
          1,
          1,
        ).data
      return [data[0], data[1], data[2]]
    },
    { x: at.x - box.x + dx, y: at.y - box.y },
  )
}

/** The signal the status bar reads out with the pointer at a plan point. */
async function signalAt(page: Page, x: number, y: number) {
  const at = await screenPoint(page, x, y)
  await page.mouse.move(at.x, at.y)
  const readout = page.locator('.readout')
  await expect(readout).toContainText('dBm')
  return /(-?\d+) dBm/.exec((await readout.textContent())!)![1]!
}

/** A spot far from the router, behind several walls. */
const FAR = { x: 13.5, y: 8.5 }

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('Calibrate fits, previews, applies and resets (D76)', async ({ page }) => {
  await openPlan(page, surveyed)
  await expect(coverageStatus(page)).toHaveText(/^\d+% of/)
  const before = await signalAt(page, FAR.x, FAR.y)

  await panel(page).getByRole('button', { name: 'Calibrate' }).click()
  const five = panel(page).getByRole('region', { name: '5 GHz calibration' })
  await expect(five).toContainText(
    /RMS error \d+\.\d → \d+\.\d dB, mean [+−]\d+\.\d dB → [+−]?\d+\.\d dB/,
  )
  await expect(
    five.getByRole('rowheader', { name: /Path loss exponent/ }),
  ).toBeVisible()
  await expect(
    five.getByRole('rowheader', { name: /Phone offset/ }),
  ).toContainText('not on the heatmap')
  await expect(
    panel(page).getByRole('region', { name: '2.4 GHz calibration' }),
  ).toBeVisible()
  await expect(
    panel(page).getByRole('region', { name: '6 GHz calibration' }),
  ).toBeVisible()

  // The map previews the fit: the model fades signal faster in this home.
  await expect(coverageStatus(page)).toHaveText(/^With the calibration: /)
  await expect.poll(() => signalAt(page, FAR.x, FAR.y)).not.toBe(before)
  const calibrated = await signalAt(page, FAR.x, FAR.y)

  await panel(page).getByRole('button', { name: 'Apply' }).click()
  await expect(panel(page)).toContainText(
    'Calibrated to this home’s survey on 2.4 GHz, 5 GHz and 6 GHz.',
  )
  await expect(coverageStatus(page)).toHaveText(/^\d+% of/)
  await expect.poll(() => signalAt(page, FAR.x, FAR.y)).toBe(calibrated)

  // One undo step each way.
  await page.keyboard.press('Control+z')
  await expect.poll(() => signalAt(page, FAR.x, FAR.y)).toBe(before)
  await expect(panel(page)).not.toContainText('Calibrated to this home')
  await page.keyboard.press('Control+Shift+z')
  await expect(panel(page)).toContainText('Calibrated to this home')
  await expect.poll(() => signalAt(page, FAR.x, FAR.y)).toBe(calibrated)

  // Reset to defaults puts every band back.
  await panel(page).getByRole('button', { name: 'Reset to defaults' }).click()
  await expect.poll(() => signalAt(page, FAR.x, FAR.y)).toBe(before)
  await expect(panel(page)).not.toContainText('Calibrated to this home')
})

test('a change to the plan drops a waiting calibration (D76)', async ({
  page,
}) => {
  await openPlan(page, surveyed)
  await panel(page).getByRole('button', { name: 'Calibrate' }).click()
  await expect(panel(page).getByRole('button', { name: 'Apply' })).toBeVisible()
  const name = panel(page).getByRole('textbox', { name: 'Plan name' })
  await name.fill('Renamed')
  await name.press('Enter')
  await expect(page.locator('.status-notice')).toHaveText(
    'Calibration dismissed: the plan changed.',
  )
  await expect(panel(page).getByRole('button', { name: 'Apply' })).toHaveCount(
    0,
  )
})

test('rooms without a spot are ringed until there are enough (D76)', async ({
  page,
}) => {
  // Only the last three spots: in three of the seven rooms.
  const few = structuredClone(surveyed)
  few.floors[0].surveySpots = few.floors[0].surveySpots.slice(-3)
  await openPlan(page, few)
  // The top-left room has no spot; its ring is 14 px around a point in it.
  const plain = await canvasColour(page, 2.45, 1.95, 14)

  await panel(page).getByRole('button', { name: 'Calibrate' }).click()
  const five = panel(page).getByRole('region', { name: '5 GHz calibration' })
  await expect(five).toContainText('Not enough spots to fit yet.')
  await expect(five).toContainText('Needs readings at 10 spots or more; has 3.')
  await expect(five).toContainText('Spots in 3 of 7 rooms; needs 4.')
  await expect.poll(() => canvasColour(page, 2.45, 1.95, 14)).not.toEqual(plain)
  await expect(
    panel(page).getByRole('button', { name: 'Apply' }),
  ).toBeDisabled()

  await panel(page).getByRole('button', { name: 'Dismiss' }).click()
  await expect.poll(() => canvasColour(page, 2.45, 1.95, 14)).toEqual(plain)
})
