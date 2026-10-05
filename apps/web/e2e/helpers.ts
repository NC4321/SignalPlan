import { deflateSync, crc32 } from 'node:zlib'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** Where a plan point (in metres) appears on the page. */
export async function screenPoint(page: Page, x: number, y: number) {
  const canvas = page.locator('.editor-canvas')
  const box = (await canvas.boundingBox())!
  const camera = await canvas.evaluate((el) => ({
    scale: Number(el.dataset['scale']),
    offsetX: Number(el.dataset['offsetX']),
    offsetY: Number(el.dataset['offsetY']),
  }))
  return {
    x: box.x + camera.offsetX + x * camera.scale,
    y: box.y + camera.offsetY + y * camera.scale,
  }
}

/** The plan point (in metres) under a page position. */
export async function planPoint(page: Page, at: { x: number; y: number }) {
  const origin = await screenPoint(page, 0, 0)
  const unit = await screenPoint(page, 1, 0)
  const scale = unit.x - origin.x
  return { x: (at.x - origin.x) / scale, y: (at.y - origin.y) / scale }
}

/** Clicks a plan point (in metres). */
export async function clickPlan(page: Page, x: number, y: number) {
  const at = await screenPoint(page, x, y)
  await page.mouse.click(at.x, at.y)
}

/** Opens the app and waits until the plan has been fitted to the canvas. */
export async function openEditor(page: Page) {
  await page.goto('/')
  await page.locator('.editor-canvas[data-scale]').waitFor({ state: 'visible' })
}

/** Fails on serious or critical axe-core findings, listing them. */
export async function expectNoSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    )
  expect(serious).toEqual([])
}

/** The number shown next to a label in the plan summary. */
export async function summaryCount(page: Page, label: string) {
  const text = await page
    .getByRole('complementary', { name: 'Properties' })
    .locator('dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]')
    .textContent()
  return Number(text)
}

/** A 200 × 100 PNG: grey with a dark frame, like a scanned plan. */
export function planImage(): Buffer {
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
