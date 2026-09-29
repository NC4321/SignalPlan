import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/**
 * The canvas colour inside a pin's head, left of its centre dot: the head is
 * 17 px above the spot with a 7 px radius (render.ts).
 */
async function pinColour(page: Page, x: number, y: number) {
  return canvasColour(page, x, y, -4)
}

/** The canvas colour `dx` px right of a pin's head centre. */
async function canvasColour(page: Page, x: number, y: number, dx: number) {
  const canvas = page.locator('.editor-canvas')
  const box = (await canvas.boundingBox())!
  const tip = await screenPoint(page, x, y)
  const at = { x: tip.x - box.x + dx, y: tip.y - box.y - 17 }
  return canvas.evaluate((el: HTMLCanvasElement, p) => {
    const ratio = el.width / el.getBoundingClientRect().width
    const data = el
      .getContext('2d')!
      .getImageData(Math.round(p.x * ratio), Math.round(p.y * ratio), 1, 1).data
    return [data[0], data[1], data[2]]
  }, at)
}

async function setSignal(page: Page, dbm: number) {
  const signal = panel(page).getByRole('textbox', { name: /Signal \(dBm\)/ })
  await signal.fill(String(dbm))
  await signal.press('Enter')
}

test('pins and the report compare predicted with measured (D73)', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await clickPlan(page, 3, 4)
  await panel(page).getByRole('button', { name: 'Add a reading' }).click()
  await panel(page).getByRole('combobox', { name: /Band/ }).selectOption('5GHz')

  // The reading row shows the model's value at the spot.
  const prediction = panel(page).locator('.reading-prediction')
  await expect(prediction).toContainText(/Predicted −\d+\.\d dBm/)
  const predicted = Number(
    /Predicted −(\d+\.\d)/.exec((await prediction.textContent())!)![1],
  )

  // Measured as predicted: within ±2 dB, the neutral colour.
  await setSignal(page, -Math.round(predicted))
  await expect.poll(() => pinColour(page, 3, 4)).toEqual([247, 247, 247])

  // Measured 20 dB weaker: the model is far too hopeful, dark orange.
  await setSignal(page, -Math.round(predicted) - 20)
  await expect(prediction).toContainText(/error \+(19|20|21)\.\d dB/)
  await expect.poll(() => pinColour(page, 3, 4)).toEqual([179, 88, 6])

  // Measured 7 dB stronger: too gloomy, the middle purple.
  await setSignal(page, -Math.round(predicted) + 7)
  await expect.poll(() => pinColour(page, 3, 4)).toEqual([153, 142, 195])
  await expect(
    panel(page).getByRole('heading', { name: 'Survey pins' }),
  ).toBeVisible()

  // Hovering the pin draws its card, in the surface colour, past its label.
  const head = await screenPoint(page, 3, 4)
  await page.mouse.move(head.x + 200, head.y + 200)
  await expect
    .poll(() => canvasColour(page, 3, 4, 100))
    .not.toEqual([255, 255, 255])
  await page.mouse.move(head.x, head.y - 17)
  await expect
    .poll(() => canvasColour(page, 3, 4, 100))
    .toEqual([255, 255, 255])
  await page.mouse.move(head.x + 200, head.y + 200)
  await expect
    .poll(() => canvasColour(page, 3, 4, 100))
    .not.toEqual([255, 255, 255])

  // The report, in the plan panel once back to Select with nothing selected.
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(
    panel(page).getByRole('heading', { name: 'Predicted versus measured' }),
  ).toBeVisible()
  const row = panel(page).getByRole('row', { name: /^5 GHz/ })
  await expect(row).toContainText('1')
  await expect(row).toContainText(/−(6|7|8)\.\d dB/)

  // Furthest off shows the spot's band and selects it.
  await page.getByText('2.4 GHz', { exact: true }).click()
  await expect.poll(() => pinColour(page, 3, 4)).not.toEqual([153, 142, 195])
  await panel(page)
    .getByRole('button', { name: /^Spot 1, 5 GHz: −/ })
    .click()
  await expect(page.getByRole('radio', { name: '5 GHz' })).toBeChecked()
  await expect(
    panel(page).getByRole('heading', { name: 'Spot 1' }),
  ).toBeVisible()
})

/** The canvas colour at a plan point, in metres. */
async function planColour(page: Page, x: number, y: number) {
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
    { x: at.x - box.x, y: at.y - box.y },
  )
}

test('the heatmap fades while surveying, unless turned off (D74)', async ({
  page,
}) => {
  // A point in the big room, clear of walls, pins, labels and grid lines.
  const full = await planColour(page, 9.45, 6.45)
  await page.keyboard.press('s')
  await expect.poll(() => planColour(page, 9.45, 6.45)).not.toEqual(full)
  const faded = await planColour(page, 9.45, 6.45)
  // Faded towards the canvas colour behind it.
  const hex = await page
    .locator('.editor-canvas')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--canvas').trim())
  const canvas = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const away = (rgb: (number | undefined)[]) =>
    rgb.reduce((total: number, c, i) => total + Math.abs(c! - canvas[i]!), 0)
  expect(away(faded)).toBeLessThan(away(full) / 2)

  const fade = panel(page).getByRole('checkbox', {
    name: 'Fade heatmap behind pins',
  })
  await expect(fade).toBeChecked()
  await fade.uncheck()
  await expect.poll(() => planColour(page, 9.45, 6.45)).toEqual(full)
  await fade.check()
  await expect.poll(() => planColour(page, 9.45, 6.45)).toEqual(faded)

  // Back on Select with nothing selected, it's full strength again.
  await page.keyboard.press('v')
  await expect.poll(() => planColour(page, 9.45, 6.45)).toEqual(full)
})
