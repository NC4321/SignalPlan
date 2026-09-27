import { deflateSync, crc32 } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

/** A 200 × 100 PNG: grey with a dark frame, like a scanned plan. */
function planImage(): Buffer {
  const width = 200
  const height = 100
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) {
      const edge = x < 4 || y < 4 || x >= width - 4 || y >= height - 4
      row.fill(edge ? 40 : 220, 1 + x * 3, 4 + x * 3)
    }
    rows.push(row)
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Starts a blank plan and adds the test image, which starts calibration. */
async function addImage(page: Page) {
  await openEditor(page)
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await page.getByLabel('Choose a floor plan image to trace').setInputFiles({
    name: 'plan.png',
    mimeType: 'image/png',
    buffer: planImage(),
  })
  await expect(
    page.getByRole('region', { name: 'Calibrate the image' }),
  ).toBeVisible()
}

/** The canvas's centre on the page, and its plan scale in px per metre. */
async function view(page: Page) {
  const canvas = page.locator('.editor-canvas')
  const box = (await canvas.boundingBox())!
  const scale = Number(await canvas.getAttribute('data-scale'))
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, scale }
}

/** The image's size on the plan, from the panel: [width, height] in metres. */
async function imageSize(page: Page): Promise<[number, number]> {
  const text = await panel(page)
    .getByRole('region', { name: 'Tracing image' })
    .locator('.kind')
    .textContent()
  const [width, height] = [...text!.matchAll(/([\d.]+) m/g)].map((m) =>
    Number(m[1]),
  )
  return [width!, height!]
}

const undoButton = (page: Page) =>
  page.getByRole('group', { name: 'History' }).getByRole('button', {
    name: 'Undo',
  })

/**
 * Calibrates by clicking two points 200 px apart, left of centre, and typing
 * twice the distance they are apart on the plan, so the image doubles in size
 * about the first point. Returns that point.
 */
async function calibrateDouble(page: Page) {
  const { x, y, scale } = await view(page)
  const a = { x: x - 150, y }
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(a.x + 200, a.y)
  const real = (2 * 200) / scale
  await page
    .getByLabel('Real distance between the two points')
    .fill(real.toFixed(3))
  await page.getByRole('button', { name: 'Set scale' }).click()
  return { a, real, measured: 200 / scale }
}

test('adds, calibrates and undoes calibration of a tracing image', async ({
  page,
}) => {
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  await addImage(page)
  const tracing = panel(page).getByRole('region', { name: 'Tracing image' })
  await expect(tracing).toBeVisible()
  const [before] = await imageSize(page)

  const { real, measured } = await calibrateDouble(page)
  await expect(
    page.getByRole('region', { name: 'Calibrate the image' }),
  ).toBeHidden()
  const [after] = await imageSize(page)
  expect(after).toBeCloseTo((before * real) / measured, 1)
  await expect(tracing.getByLabel('Lock in place')).toBeChecked()
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Calibrate tracing image/,
  )

  await page.keyboard.press('ControlOrMeta+z')
  expect((await imageSize(page))[0]).toBeCloseTo(before, 2)
  await expect(tracing.getByLabel('Lock in place')).not.toBeChecked()
  await page.keyboard.press('ControlOrMeta+Shift+z')
  expect((await imageSize(page))[0]).toBeCloseTo(after, 2)
  expect(errors).toEqual([])
})

test('changes opacity, visibility and lock, each undoable', async ({
  page,
}) => {
  await addImage(page)
  await page.getByRole('button', { name: 'Skip' }).click()
  const tracing = panel(page).getByRole('region', { name: 'Tracing image' })

  const opacity = tracing.getByRole('slider')
  await expect(tracing.getByText('Opacity 50%')).toBeVisible()
  await opacity.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(tracing.getByText('Opacity 60%')).toBeVisible()
  // Each key press is its own step; undo takes back the last one.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(tracing.getByText('Opacity 55%')).toBeVisible()

  await tracing.getByLabel('Show image').uncheck()
  await expect(opacity).toBeDisabled()
  await expect(
    tracing.getByRole('button', { name: 'Recalibrate' }),
  ).toBeDisabled()
  await undoButton(page).click()
  await expect(tracing.getByLabel('Show image')).toBeChecked()

  await tracing.getByLabel('Lock in place').check()
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Lock tracing image/,
  )
  await undoButton(page).click()
  await expect(tracing.getByLabel('Lock in place')).not.toBeChecked()
})

test('drags an unlocked image but not a locked one', async ({ page }) => {
  await addImage(page)
  const { a } = await calibrateDouble(page)
  const tracing = panel(page).getByRole('region', { name: 'Tracing image' })
  const start = { x: a.x - 30, y: a.y + 30 }

  // Calibration locks the image, so dragging it does nothing.
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 5 })
  await page.mouse.up()
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Calibrate tracing image/,
  )

  await tracing.getByLabel('Lock in place').uncheck()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 5 })
  await page.mouse.up()
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Move tracing image/,
  )
  // The whole drag is one step: undoing it leaves the unlock to undo next.
  await undoButton(page).click()
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Unlock tracing image/,
  )
})

test('removes the image, and undo restores it', async ({ page }) => {
  await addImage(page)
  await page.getByRole('button', { name: 'Skip' }).click()
  const tracing = panel(page).getByRole('region', { name: 'Tracing image' })
  await tracing.getByRole('button', { name: 'Remove' }).click()
  await expect(tracing).toBeHidden()
  await undoButton(page).click()
  await expect(tracing).toBeVisible()
})

test('replaces the image with one of the same proportions, keeping its scale', async ({
  page,
}) => {
  await addImage(page)
  await calibrateDouble(page)
  const size = await imageSize(page)
  const tracing = panel(page).getByRole('region', { name: 'Tracing image' })
  await tracing.getByRole('button', { name: 'Replace image…' }).click()
  await page.getByLabel('Choose a floor plan image to trace').setInputFiles({
    name: 'plan-2.png',
    mimeType: 'image/png',
    buffer: planImage(),
  })
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Replace tracing image/,
  )
  await expect(
    page.getByRole('region', { name: 'Calibrate the image' }),
  ).toBeHidden()
  expect(await imageSize(page)).toEqual(size)
})

test('saves the image inside the file and opens it again', async ({ page }) => {
  await addImage(page)
  await calibrateDouble(page)
  const size = await imageSize(page)

  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const file = await download
  const chunks = await (await file.createReadStream()).toArray()
  const text = Buffer.concat(chunks).toString('utf8')
  const plan = JSON.parse(text)
  const background = plan.floors[0].background
  expect(background.imageId).toBeUndefined()
  expect(background.dataUrl).toMatch(/^data:image\/png;base64,/)
  expect(background).toMatchObject({ widthPx: 200, heightPx: 100 })

  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await expect(
    panel(page).getByRole('region', { name: 'Tracing image' }),
  ).toBeHidden()
  await page.getByLabel('Open a plan file').setInputFiles({
    name: 'traced.signalplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await expect(
    panel(page).getByRole('region', { name: 'Tracing image' }),
  ).toBeVisible()
  expect(await imageSize(page)).toEqual(size)
})
