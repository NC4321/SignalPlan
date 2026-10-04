/**
 * Records the README's demo GIFs. The clip is the first argument:
 *
 *   editor     docs/demo.gif: a new plan, a brick room with a concrete wall
 *              across it, a router placed and then dragged around
 *   optimizer  docs/demo-optimizer.gif: the sample home's router moved to a
 *              better spot, then one more access point suggested
 *   3d         docs/demo-3d.gif: the two-storey home in the 3D view
 *   views      docs/demo-views.gif: the three-AP home upstairs at 80 MHz,
 *              shown as Roaming, Overlap and Interference with the channel
 *              plan without DFS, then with DFS allowed and planned again
 *   survey     docs/demo-survey.gif: the surveyed bungalow's pins coloured by
 *              error, a scan placed at a new spot, then Calibrate and Apply,
 *              which shrink the errors
 *
 * To rerun them:
 *
 *   pnpm build
 *   pnpm --filter @signalplan/web preview        # serves on port 4173
 *   node scripts/record-demo.mjs editor          # needs ffmpeg on the PATH
 *
 * Options through environment variables: DEMO_URL (default
 * http://localhost:4173/), CHROMIUM_PATH (default: Playwright's own browser),
 * DEMO_OUT (default: the clip's file above). It isn't run in CI.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const require = createRequire(join(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const clips = {
  editor: 'docs/demo.gif',
  optimizer: 'docs/demo-optimizer.gif',
  '3d': 'docs/demo-3d.gif',
  views: 'docs/demo-views.gif',
  survey: 'docs/demo-survey.gif',
}
// The gallery clips show at half the README's width, so they keep only
// the tool rail, canvas and status bar, cutting the top bar and panel.
const galleryCrop = 'crop=1028:754:0:46,'
const clip = process.argv[2] ?? 'editor'
if (!(clip in clips)) {
  throw new Error(`Unknown clip "${clip}"; use one of ${Object.keys(clips)}`)
}
const url = process.env.DEMO_URL ?? 'http://localhost:4173/'
const out = process.env.DEMO_OUT ?? join(root, clips[clip])
const width = 1280
const height = 800
const gifWidth = clip === 'editor' ? 800 : 640
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
// A first visit shows the guide card over the plan; mark it seen, as the e2e
// tests do, so it isn't in the clip.
await context.addInitScript(() => {
  try {
    localStorage.setItem('signalplan:guide', 'seen')
  } catch {
    // No storage: the guide shows, as it would for anyone.
  }
})
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
  await locator.scrollIntoViewIfNeeded()
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

const tools = page.getByRole('toolbar', { name: 'Tools' })
const panel = page.getByRole('complementary', { name: 'Properties' })
const coverage = page.locator('.status-bar .coverage-status')

let clipStart = 0
/** Starts recording; everything before it is set-up, cut from the clip. */
async function record() {
  await page.mouse.move(mouse.x, mouse.y)
  await screencast.send('Page.startScreencast', {
    format: 'png',
    maxWidth: width,
    maxHeight: height,
  })
  await page.waitForTimeout(600)
  clipStart = now()
  await page.waitForTimeout(500)
}

/** Opens one of the checked-in test homes. */
async function openFixture(name) {
  await page
    .getByLabel('Open a plan file')
    .setInputFiles(join(root, 'packages/floorplan/fixtures', name))
  await page.locator('.editor-canvas[data-scale]').waitFor()
}

/** Finds a suggestion with an optimizer button, then applies it. */
async function suggestAndApply(name) {
  await clickLocator(panel.getByRole('button', { name }), 450)
  const apply = panel.getByRole('button', { name: 'Apply' })
  await apply.waitFor()
  await page.waitForTimeout(1800)
  await clickLocator(apply, 450)
  await page.waitForTimeout(900)
}

await page.goto(url)
await page.locator('.editor-canvas[data-scale]').waitFor()

if (clip === 'editor') {
  // Set-up: a new plan without its default router.
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  const router = await at(5, 4)
  await page.mouse.click(router.x, router.y)
  await page.keyboard.press('Delete')
  await record()

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
} else if (clip === 'optimizer') {
  // The sample home opens by default, with its router by the front door.
  await coverage.getByText(/^86% of/).waitFor()
  await record()
  await suggestAndApply('Find a better spot for Wi-Fi 6E router')
  await coverage.getByText(/^92% of/).waitFor()
  // Applying selects the router; clear that to suggest a new one.
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Escape')
  await suggestAndApply('Suggest one more access point')
  await coverage.getByText(/^100% of/).waitFor()
  await page.waitForTimeout(1200)
} else if (clip === '3d') {
  await openFixture('two-storey-home.json')
  await page.getByRole('group', { name: 'View' }).getByText('3D').click()
  await page.locator('.view3d-canvas canvas').waitFor()
  await page.waitForTimeout(1500)
  await record()

  // Spread the floors apart, then turn the house around.
  const slider = panel.getByLabel('Spread floors apart')
  const box = await slider.boundingBox()
  const y = box.y + box.height / 2
  await glide(box.x + 6, y, 500)
  await page.mouse.down()
  await glide(box.x + box.width * 0.55, y, 1200)
  await page.mouse.up()
  await page.waitForTimeout(600)
  const view = await page.locator('.view3d-canvas canvas').boundingBox()
  const cx = view.x + view.width / 2
  const cy = view.y + view.height / 2
  await glide(cx - 120, cy + 60, 450)
  await page.mouse.down()
  await glide(cx + 160, cy + 20, 2200)
  await glide(cx + 40, cy - 40, 1200)
  await page.mouse.up()
  await page.waitForTimeout(1200)
} else if (clip === 'views') {
  // Set-up: the three-AP home (D69) with 80 MHz set on 5 GHz, and the
  // channel planner's least-bad plan without DFS showing on the map.
  const home = JSON.parse(
    readFileSync(
      join(root, 'packages/floorplan/fixtures/three-ap-home.json'),
      'utf8',
    ),
  )
  for (const ap of home.accessPoints) {
    for (const radio of ap.radios) {
      if (radio.band === '5GHz') radio.channelWidthMHz = 80
    }
  }
  const file = join(frameDir, 'three-ap-home-80.json')
  writeFileSync(file, JSON.stringify(home))
  await page.getByLabel('Open a plan file').setInputFiles(file)
  await page.locator('.editor-canvas[data-scale]').waitFor()
  await page.getByRole('button', { name: 'Upstairs', exact: true }).click()
  await panel.getByRole('button', { name: 'Plan channels' }).click()
  const show = page.getByLabel('Show', { exact: true })
  await show.selectOption({ label: 'Roaming' })
  await page.locator('.editor-canvas').focus()
  await coverage.getByText(/^Upstairs:/).waitFor()
  await record()

  await page.waitForTimeout(1200)
  for (const label of ['Overlap', 'Interference']) {
    await show.selectOption({ label })
    await page.waitForTimeout(2200)
  }
  await coverage.getByText(/^Upstairs: 19% /).waitFor()
  await page.waitForTimeout(600)
  // Off the cropped clip, in the panel: allow DFS and plan again, which
  // clears the clash between the two mesh points.
  await panel.evaluate((el) => {
    const box = [...el.querySelectorAll('label')]
      .find((l) => l.textContent.includes('Allow DFS channels'))
      .querySelector('input')
    box.click()
    ;[...el.querySelectorAll('button')]
      .find((b) => b.textContent === 'Plan channels')
      .click()
  })
  await coverage.getByText(/^Upstairs: 0% /).waitFor()
  await page.waitForTimeout(2600)
} else if (clip === 'survey') {
  // Set-up: the surveyed bungalow (11 spots read from its router on every
  // band) with the router's BSSIDs known, so a scan matches them.
  const home = JSON.parse(
    readFileSync(
      join(root, 'packages/floorplan/fixtures/surveyed-home.json'),
      'utf8',
    ),
  )
  const bssids = {
    '2.4GHz': 'a4:2b:b0:12:34:51',
    '5GHz': 'a4:2b:b0:12:34:52',
    '6GHz': 'a4:2b:b0:12:34:53',
  }
  for (const radio of home.accessPoints[0].radios) {
    radio.bssids = [bssids[radio.band]]
  }
  const file = join(frameDir, 'surveyed-home-bssids.json')
  writeFileSync(file, JSON.stringify(home))
  await page.getByLabel('Open a plan file').setInputFiles(file)
  await page.locator('.editor-canvas[data-scale]').waitFor()
  await page.waitForTimeout(1500)
  await record()

  // The pins are coloured by how far the model is from each reading.
  await page.waitForTimeout(900)
  const pin = await at(7.95, 4.95)
  await glide(pin.x, pin.y - 14, 700)
  await page.waitForTimeout(1500)

  // A scan taken at a new spot becomes that spot's readings. (The buttons
  // are in the panel, which the clip crops away.)
  await clickLocator(
    panel.getByRole('button', { name: 'Scan your network…' }).last(),
    500,
  )
  const reader = page.getByRole('dialog', { name: 'Scan your network' })
  await reader.getByRole('textbox', { name: 'What it printed' }).fill(
    JSON.stringify({
      signalplanScan: 1,
      networks: [
        {
          bssid: bssids['2.4GHz'],
          ssid: 'HomeNet',
          band: '2.4',
          channel: 6,
          dbm: -36,
        },
        {
          bssid: bssids['5GHz'],
          ssid: 'HomeNet',
          band: '5',
          channel: 36,
          dbm: -41,
        },
        {
          bssid: bssids['6GHz'],
          ssid: 'HomeNet',
          band: '6',
          channel: 37,
          dbm: -47,
        },
      ],
    }),
  )
  await page.waitForTimeout(800)
  await reader.getByRole('button', { name: 'Read scan' }).click()
  const answers = page.getByRole('dialog', {
    name: 'Which networks are yours?',
  })
  await answers
    .getByRole('radio', { name: /click the plan after Apply/ })
    .check()
  await page.waitForTimeout(1200)
  await answers.getByRole('button', { name: 'Apply, then click…' }).click()
  const spot = await at(5, 4)
  await clickAt(spot.x, spot.y, 600)
  await page.waitForTimeout(900)

  // Calibrate fits the model to the readings; the map previews the fit, and
  // Apply keeps it, with the errors on the pins shrinking.
  await page.keyboard.press('Escape')
  await clickLocator(panel.getByRole('button', { name: 'Calibrate' }), 450)
  const apply = panel.getByRole('button', { name: 'Apply' })
  await apply.waitFor()
  await page.waitForTimeout(1500)
  await clickLocator(apply, 450)
  await coverage.getByText(/^\d+% of/).waitFor()
  await glide(pin.x + 60, pin.y + 60, 400)
  await page.waitForTimeout(1800)
}
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

const crop = clip === 'editor' ? '' : galleryCrop
const filters = `${crop}scale=${gifWidth}:-1:flags=lanczos`
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
