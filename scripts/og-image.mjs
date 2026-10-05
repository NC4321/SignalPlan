/**
 * Makes the link-preview images in apps/web/public/ from the built app:
 *
 *   og-image.png          1200×630, the picture a link to the app shows on
 *                         Reddit, Slack, Discord, iMessage, X and the like: the
 *                         sample home's heatmap in the app as it opens, under a
 *                         band with the name and what it does
 *   apple-touch-icon.png  180×180, favicon.svg on white, for an iPhone or iPad
 *                         home screen
 *
 * index.html points at both (og:image with the deployed address, so the
 * preview only changes once the new image is deployed). To rerun them:
 *
 *   pnpm build
 *   pnpm --filter @signalplan/web preview --port 4403 &   # then stop it after
 *   CHROMIUM_PATH=/path/to/chrome node scripts/og-image.mjs
 *
 * Options through environment variables: DEMO_URL (default
 * http://localhost:4403/), CHROMIUM_PATH (default: Playwright's own browser)
 * and OG_OUT (default apps/web/public). The app is captured at twice the size
 * and put together with the band in a second browser page, so the heatmap is
 * the app as it drew it. It isn't run in CI.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const require = createRequire(join(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const url = process.env.DEMO_URL ?? 'http://localhost:4403/'
const outDir = process.env.OG_OUT ?? join(root, 'apps/web/public')
const favicon = readFileSync(join(root, 'apps/web/public/favicon.svg'))
const svgSrc = `data:image/svg+xml;base64,${favicon.toString('base64')}`

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
)
const errors = []

function save(name, buffer) {
  const file = join(outDir, name)
  writeFileSync(file, buffer)
  console.log(`Wrote ${file} (${Math.round(buffer.length / 1024)} KB)`)
}

/** The sample home as it first opens, in the light theme, as a PNG buffer. */
async function captureApp({ width, height }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: 'light',
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
  await page
    .locator('.status-bar .coverage-status')
    .getByText(/^86% of/)
    .waitFor()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(800)
  const buffer = await page.screenshot()
  await context.close()
  return buffer
}

// The band's height plus the app scaled to 1200 wide make 630.
const band = 112
const app = await captureApp({ width: 1280, height: 553 })

{
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
  })
  const appSrc = `data:image/png;base64,${app.toString('base64')}`
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box }
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden;
      font-family: system-ui, 'Segoe UI', Roboto, sans-serif; background: #fff }
    .band { height: ${band}px; display: flex; align-items: center; gap: 24px;
      padding: 0 40px; background: #1f1e24; color: #ecebef }
    .band img { width: 58px; height: 56px }
    .name { font-size: 40px; font-weight: 700; letter-spacing: -0.01em }
    .what { font-size: 25px; line-height: 1.25 }
    .what span { color: #a6a2ad; font-size: 20px }
    .app { display: block; width: 1200px; height: ${630 - band}px;
      object-fit: cover; object-position: top }
  </style></head><body>
    <div class="band">
      <img src="${svgSrc}" alt="">
      <div class="name">SignalPlan</div>
      <div class="what">Predict your home’s Wi-Fi from a floor plan<br>
        <span>Free and open source · runs in your browser · no account</span></div>
    </div>
    <img class="app" src="${appSrc}" alt="">
  </body></html>`)
  await page.locator('img.app').evaluate((img) => img.decode())
  save('og-image.png', await page.screenshot())
  await page.close()
}

{
  const page = await browser.newPage({
    viewport: { width: 180, height: 180 },
  })
  await page.setContent(`<!doctype html><html><body style="margin:0;
    width:180px;height:180px;display:grid;place-items:center;background:#fff">
    <img src="${svgSrc}" style="width:124px;height:119px" alt="">
  </body></html>`)
  await page.locator('img').evaluate((img) => img.decode())
  save('apple-touch-icon.png', await page.screenshot())
  await page.close()
}

await browser.close()
if (errors.length > 0) throw new Error(`Page errors: ${errors.join('\n')}`)
