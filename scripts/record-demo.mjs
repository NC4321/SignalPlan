/**
 * Records the README demo, docs/demo.gif: a new plan, a brick room with a
 * concrete wall across it, a router placed and then dragged around.
 *
 * To rerun it:
 *
 *   pnpm build
 *   pnpm --filter @signalplan/web preview        # serves on port 4173
 *   node scripts/record-demo.mjs                 # needs ffmpeg on the PATH
 *
 * Options through environment variables: DEMO_URL (default
 * http://localhost:4173/), CHROMIUM_PATH (default: Playwright's own browser),
 * DEMO_OUT (default docs/demo.gif). It isn't run in CI.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const require = createRequire(join(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const url = process.env.DEMO_URL ?? 'http://localhost:4173/'
const out = process.env.DEMO_OUT ?? join(root, 'docs/demo.gif')
const width = 1280
const height = 800
const gifWidth = 800
const fps = 12

// Headless Chromium draws no pointer, so show one: an arrow that follows the
// mouse and a ring on each press.
const cursorScript = () => {
  addEventListener('DOMContentLoaded', () => {
    const arrow = document.createElement('div')
    arrow.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 18 L6.5 13.5 L9.5 20 L12 19 L9 12.5 L15 12.5 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    Object.assign(arrow.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '99999',
      pointerEvents: 'none',
      transform: 'translate(-2px, -2px)',
    })
    document.body.append(arrow)
    const place = (event) => {
      arrow.style.left = `${event.clientX}px`
      arrow.style.top = `${event.clientY}px`
    }
    addEventListener('pointermove', place, true)
    addEventListener(
      'pointerdown',
      (event) => {
        place(event)
        const ring = document.createElement('div')
        Object.assign(ring.style, {
          position: 'fixed',
          left: `${event.clientX - 14}px`,
          top: `${event.clientY - 14}px`,
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          border: '3px solid #d33',
          zIndex: '99998',
          pointerEvents: 'none',
          transition: 'opacity 400ms, transform 400ms',
        })
        document.body.append(ring)
        requestAnimationFrame(() => {
          ring.style.opacity = '0'
          ring.style.transform = 'scale(1.6)'
        })
        setTimeout(() => ring.remove(), 450)
      },
      true,
    )
  })
}

const frameDir = mkdtempSync(join(tmpdir(), 'signalplan-demo-'))
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
)
const context = await browser.newContext({ viewport: { width, height } })
await context.addInitScript(cursorScript)
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error))

// Chromium's screencast sends a frame whenever the page repaints, with its
// time. (Playwright's own video recording needs a separate ffmpeg download.)
const screencast = await context.newCDPSession(page)
const frames = []
screencast.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  frames.push({ time: metadata.timestamp, data })
  void screencast.send('Page.screencastFrameAck', { sessionId })
})
const now = () => Date.now() / 1000

let mouse = { x: width / 2, y: height / 2 }
/** Moves the mouse to a page position over `ms`, easing in and out. */
async function glide(x, y, ms = 400) {
  const from = mouse
  const start = Date.now()
  // Timed by the clock, since each move takes a variable while.
  for (let t = 0; t < 1;) {
    t = Math.min(1, (Date.now() - start) / ms)
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
    await page.waitForTimeout(10)
  }
  mouse = { x, y }
}
async function clickAt(x, y, ms) {
  await glide(x, y, ms)
  await page.mouse.click(x, y)
  await page.waitForTimeout(120)
}
async function clickLocator(locator, ms) {
  const box = await locator.boundingBox()
  await clickAt(box.x + box.width / 2, box.y + box.height / 2, ms)
}

const canvas = page.locator('.editor-canvas')
/** Where a plan point (in metres) appears on the page. */
async function at(x, y) {
  const box = await canvas.boundingBox()
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

// Set-up, cut from the recording: a new plan without its default router.
await page.goto(url)
await page.locator('.editor-canvas[data-scale]').waitFor()
await page.getByText('File', { exact: true }).click()
await page.getByRole('button', { name: 'New plan' }).click()
const router = await at(5, 4)
await page.mouse.click(router.x, router.y)
await page.keyboard.press('Delete')
await page.mouse.move(mouse.x, mouse.y)
await screencast.send('Page.startScreencast', {
  format: 'png',
  maxWidth: width,
  maxHeight: height,
})
await page.waitForTimeout(600)
const clipStart = now()

// The demo.
await page.waitForTimeout(500)
const tools = page.getByRole('toolbar', { name: 'Tools' })
const panel = page.getByRole('complementary', { name: 'Properties' })
await clickLocator(tools.getByRole('button', { name: 'Wall' }), 450)
await clickLocator(panel.getByRole('radio', { name: 'Brick' }), 400)
for (const [x, y] of [
  [1, 1],
  [9, 1],
  [9, 7],
  [1, 7],
  [1, 1],
]) {
  const p = await at(x, y)
  await clickAt(p.x, p.y, 380)
}
await clickLocator(panel.getByRole('radio', { name: 'Concrete' }), 450)
for (const [x, y] of [
  [5.5, 1],
  [5.5, 4.5],
]) {
  const p = await at(x, y)
  await clickAt(p.x, p.y, 400)
}
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await clickLocator(tools.getByRole('button', { name: 'Access point' }), 450)
const placed = await at(3, 4)
await clickAt(placed.x, placed.y, 450)
await page.keyboard.press('Escape')
await page.waitForTimeout(700)

// Drag the router behind the concrete wall and back.
await glide(placed.x, placed.y, 200)
await page.mouse.down()
for (const [x, y] of [
  [7.3, 2.3],
  [7.5, 5.8],
  [4, 5.5],
]) {
  const p = await at(x, y)
  await glide(p.x, p.y, 950)
}
await page.mouse.up()
await page.waitForTimeout(900)
const clipEnd = now()
await screencast.send('Page.stopScreencast')

await context.close()
await browser.close()
if (errors.length > 0) throw new Error(`Page errors: ${errors.join('\n')}`)

// Resample to a steady frame rate, holding the latest frame at each tick.
let next = 0
let count = 0
for (let t = clipStart; t <= clipEnd; t += 1 / fps) {
  while (next + 1 < frames.length && frames[next + 1].time <= t) next++
  const name = `${String(count++).padStart(5, '0')}.png`
  writeFileSync(join(frameDir, name), Buffer.from(frames[next].data, 'base64'))
}

const filters = `scale=${gifWidth}:-1:flags=lanczos`
execFileSync(
  'ffmpeg',
  [
    ...['-y', '-v', 'error'],
    ...['-framerate', String(fps), '-i', join(frameDir, '%05d.png')],
    ...[
      '-filter_complex',
      `${filters},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    ],
    out,
  ],
  { stdio: 'inherit' },
)
rmSync(frameDir, { recursive: true, force: true })
console.log(`Wrote ${out} (${(clipEnd - clipStart).toFixed(1)} s)`)
