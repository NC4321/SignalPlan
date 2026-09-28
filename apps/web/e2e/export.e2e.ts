import { inflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Export image' })

async function openExport(page: Page) {
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'Export image…' }).click()
  await expect(dialog(page)).toBeVisible()
}

/** Downloads the export and reads its PNG header and top-left pixel. */
async function exportPng(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog(page).getByRole('button', { name: 'Export PNG' }).click(),
  ])
  const path = await download.path()
  const { readFile } = await import('node:fs/promises')
  const png = await readFile(path)
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.toString('latin1', 12, 16)).toBe('IHDR')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  // Concatenate the IDAT chunks and inflate them. The first pixel of the
  // first row is stored unchanged whatever the row's filter, after its
  // filter byte.
  const chunks: Buffer[] = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.toString('latin1', at + 4, at + 8)
    if (type === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const pixels = inflateSync(Buffer.concat(chunks))
  const corner = [...pixels.subarray(1, 5)]
  return { name: download.suggestedFilename(), width, height, corner }
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('exports a medium, light PNG named after the plan and band', async ({
  page,
}) => {
  await openExport(page)
  await expect(dialog(page)).toContainText('“Sample bungalow - 5 GHz.png”')
  await expect(
    dialog(page).getByRole('radio', { name: /^Medium/ }),
  ).toBeChecked()
  await expect(dialog(page).getByRole('radio', { name: 'Light' })).toBeChecked()
  const image = await exportPng(page)
  expect(image).toEqual({
    name: 'Sample bungalow - 5 GHz.png',
    width: 1920,
    height: 1200,
    corner: [255, 255, 255, 255],
  })
  await expect(dialog(page)).toBeHidden()
})

test('exports a large, dark PNG of the band on show', async ({ page }) => {
  await page.getByText('6 GHz', { exact: true }).click()
  await openExport(page)
  await dialog(page)
    .getByRole('radio', { name: /^Large/ })
    .check()
  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  const image = await exportPng(page)
  // The dark surface colour, #1f1e24.
  expect(image).toEqual({
    name: 'Sample bungalow - 6 GHz.png',
    width: 3840,
    height: 2400,
    corner: [0x1f, 0x1e, 0x24, 255],
  })
})

test('cancels without downloading', async ({ page }) => {
  let downloads = 0
  page.on('download', () => downloads++)
  await openExport(page)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).toBeHidden()
  expect(downloads).toBe(0)
})
