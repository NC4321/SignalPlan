/**
 * Captures the figures in docs/writeup.md from the built app, as PNGs in
 * docs/img/writeup-*.png:
 *
 *   shadow       the sample home's heatmap, with the concrete room's shadow
 *   optimizer    the sample home before and after "Find a better spot" and
 *                "Suggest one more access point" (a pair, side by side)
 *   3d           the two-storey home in the 3D view, floors spread apart
 *   calibration  the surveyed bungalow's pins before and after Calibrate and
 *                Apply (a pair)
 *   channels     the three-AP home's upper floor as an Interference map, with
 *                the channel plan without DFS and then with DFS allowed (a pair)
 *
 * To rerun them:
 *
 *   pnpm build
 *   pnpm --filter @signalplan/web preview --port 4403 &   # then stop it after
 *   CHROMIUM_PATH=/path/to/chrome node scripts/writeup-figures.mjs [name ...]
 *
 * With no names it captures every figure. Options through environment
 * variables: DEMO_URL (default http://localhost:4403/), CHROMIUM_PATH
 * (default: Playwright's own browser) and WRITEUP_OUT (default docs/img). The
 * pairs are put together in a second browser page from two screenshots, so
 * each half is the app as it drew it. It isn't run in CI.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const require = createRequire(join(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const names = ['shadow', 'optimizer', '3d', 'calibration', 'channels']
const wanted = process.argv.length > 2 ? process.argv.slice(2) : names
for (const name of wanted) {
  if (!names.includes(name)) {
    throw new Error(`Unknown figure "${name}"; use one of ${names}`)
  }
}
const url = process.env.DEMO_URL ?? 'http://localhost:4403/'
const outDir = process.env.WRITEUP_OUT ?? join(root, 'docs/img')
mkdirSync(outDir, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'signalplan-writeup-'))

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
)
const errors = []

/** A fresh page on the sample home, with the first-run guide marked seen. */
async function open() {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 760 },
  })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('signalplan:guide', 'seen')
    } catch {
      // No storage: the guide shows, as it would for anyone.
    }
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error))
  await page.goto(url)
  await page.locator('.editor-canvas[data-scale]').waitFor()
  // The floor list covers a corner of the plan; leave it out of the figures.
  await page.addStyleTag({
    content: '.floor-stack { display: none !important }',
  })
  return page
}

/** Opens one of the checked-in test homes, or a copy of one in `scratch`. */
async function openFixture(page, file) {
  await page.getByLabel('Open a plan file').setInputFiles(file)
  await page.locator('.editor-canvas[data-scale]').waitFor()
}
const fixture = (name) => join(root, 'packages/floorplan/fixtures', name)

/**
 * The plan on the canvas, trimmed of the empty margin, as a PNG buffer. The
 * canvas fits the plan to its width, so the same margins suit every home.
 */
async function shoot(page, { top = 92, height = 456 } = {}) {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(600)
  const map = await page.locator('.editor-canvas').boundingBox()
  return page.screenshot({
    clip: { x: map.x + 16, y: map.y + top, width: map.width - 32, height },
  })
}

/** Two screenshots side by side, with a thin gap, as one PNG buffer. */
async function pair(left, right) {
  const page = await browser.newPage()
  const src = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`
  await page.setContent(`<body style="margin:0;background:#fff">
    <div id="row" style="display:flex;gap:6px;width:max-content">
      <img src="${src(left)}"><img src="${src(right)}">
    </div></body>`)
  await page
    .locator('#row img')
    .nth(1)
    .evaluate((img) => img.decode())
  const buffer = await page.locator('#row').screenshot()
  await page.close()
  return buffer
}

function save(name, buffer) {
  const file = join(outDir, `writeup-${name}.png`)
  writeFileSync(file, buffer)
  console.log(`Wrote ${file} (${Math.round(buffer.length / 1024)} KB)`)
}

const panelOf = (page) =>
  page.getByRole('complementary', { name: 'Properties' })
const coverage = (page) => page.locator('.status-bar .coverage-status')

/** Finds a suggestion with an optimizer button, then applies it. */
async function suggestAndApply(page, name) {
  const panel = panelOf(page)
  await panel.getByRole('button', { name }).click()
  const apply = panel.getByRole('button', { name: 'Apply' })
  await apply.waitFor()
  await page.waitForTimeout(800)
  await apply.click()
  await page.waitForTimeout(600)
}

const figures = {
  async shadow() {
    const page = await open()
    await coverage(page)
      .getByText(/^86% of/)
      .waitFor()
    save('shadow', await shoot(page))
    await page.context().close()
  },

  async optimizer() {
    const view = { top: 110, height: 420 }
    const page = await open()
    await coverage(page)
      .getByText(/^86% of/)
      .waitFor()
    // One step out, so the new access point's label isn't cut off.
    await page.getByRole('button', { name: 'Zoom out' }).click()
    const before = await shoot(page, view)
    await suggestAndApply(page, 'Find a better spot for Wi-Fi 6E router')
    await coverage(page)
      .getByText(/^92% of/)
      .waitFor()
    // Applying selects the router; clear that to suggest a new one.
    await page.locator('.editor-canvas').focus()
    await page.keyboard.press('Escape')
    await suggestAndApply(page, 'Suggest one more access point')
    await coverage(page)
      .getByText(/^100% of/)
      .waitFor()
    await page.locator('.editor-canvas').focus()
    await page.keyboard.press('Escape')
    save('optimizer', await pair(before, await shoot(page, view)))
    await page.context().close()
  },

  async '3d'() {
    const page = await open()
    await openFixture(page, fixture('two-storey-home.json'))
    await page.getByRole('group', { name: 'View' }).getByText('3D').click()
    await page.locator('.view3d-canvas canvas').waitFor()
    await page.waitForTimeout(1500)
    const slider = panelOf(page).getByLabel('Spread floors apart')
    const box = await slider.boundingBox()
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.55, y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(800)
    // Turn the house a little, so both floors and the stairwell show.
    const view = await page.locator('.view3d-canvas canvas').boundingBox()
    const cx = view.x + view.width / 2
    const cy = view.y + view.height / 2
    await page.mouse.move(cx - 80, cy + 40)
    await page.mouse.down()
    await page.mouse.move(cx + 40, cy + 10, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(1200)
    await page.mouse.move(0, 0)
    save(
      '3d',
      await page.screenshot({
        clip: view,
      }),
    )
    await page.context().close()
  },

  async calibration() {
    const page = await open()
    await openFixture(page, fixture('surveyed-home.json'))
    await page.waitForTimeout(1500)
    const before = await shoot(page)
    const panel = panelOf(page)
    await panel.getByRole('button', { name: 'Calibrate' }).click()
    const apply = panel.getByRole('button', { name: 'Apply' })
    await apply.waitFor()
    await page.waitForTimeout(1200)
    await apply.click()
    await coverage(page)
      .getByText(/^\d+% of/)
      .waitFor()
    await page.waitForTimeout(800)
    save('calibration', await pair(before, await shoot(page)))
    await page.context().close()
  },

  async channels() {
    // The three-AP home with 80 MHz on 5 GHz, as the "views" demo clip has it.
    const home = JSON.parse(readFileSync(fixture('three-ap-home.json'), 'utf8'))
    for (const ap of home.accessPoints) {
      for (const radio of ap.radios) {
        if (radio.band === '5GHz') radio.channelWidthMHz = 80
      }
    }
    const file = join(scratch, 'three-ap-home-80.json')
    writeFileSync(file, JSON.stringify(home))
    const view = { top: 110, height: 420 }
    const page = await open()
    await openFixture(page, file)
    // The floor list is hidden in the figures, so press its button directly.
    await page
      .locator('.floor-stack button', { hasText: /^Upstairs$/ })
      .evaluate((button) => button.click())
    const panel = panelOf(page)
    await panel.getByRole('button', { name: 'Plan channels' }).click()
    await page
      .getByLabel('Show', { exact: true })
      .selectOption({ label: 'Interference' })
    await coverage(page)
      .getByText(/^Upstairs: 19% /)
      .waitFor()
    // One step out, so the upstairs mesh point's label isn't cut off.
    await page.getByRole('button', { name: 'Zoom out' }).click()
    const before = await shoot(page, view)
    await panel.evaluate((el) => {
      const box = [...el.querySelectorAll('label')]
        .find((l) => l.textContent.includes('Allow DFS channels'))
        .querySelector('input')
      box.click()
      ;[...el.querySelectorAll('button')]
        .find((b) => b.textContent === 'Plan channels')
        .click()
    })
    await coverage(page)
      .getByText(/^Upstairs: 0% /)
      .waitFor()
    save('channels', await pair(before, await shoot(page, view)))
    await page.context().close()
  },
}

for (const name of wanted) await figures[name]()
await browser.close()
rmSync(scratch, { recursive: true, force: true })
if (errors.length > 0) throw new Error(`Page errors: ${errors.join('\n')}`)
