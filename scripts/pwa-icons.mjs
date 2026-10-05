/**
 * Draws the install icons in apps/web/public/icons from
 * apps/web/public/favicon.svg, for the web app manifest (D98):
 *
 *   icon-192.png, icon-512.png          the logo filling the square
 *   maskable-192.png, maskable-512.png  the logo inside the safe zone on its
 *                                       own background, for launchers that
 *                                       crop icons to a circle or squircle
 *
 * (The iOS home-screen icon, apple-touch-icon.png, comes from
 * scripts/og-image.mjs, D97.)
 *
 * To rerun them after changing the favicon:
 *
 *   CHROMIUM_PATH=/path/to/chrome node scripts/pwa-icons.mjs
 *
 * CHROMIUM_PATH is optional (default: Playwright's own browser). It isn't run
 * in CI; the PNGs are committed.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const require = createRequire(join(root, 'apps/web/package.json'))
const { chromium } = require('@playwright/test')

const publicDir = join(root, 'apps/web/public')
const outDir = join(publicDir, 'icons')
mkdirSync(outDir, { recursive: true })
const svg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8')
// The logo's own background, the dark theme's --surface, as in the manifest.
const background = '#1f1e24'

// The logo's share of the icon's width. A maskable icon keeps its content in
// the middle 80% circle; the logo's walls reach 93% of the way from its
// centre to its edge, so at 80% their corner stays inside the circle.
const icons = [
  { file: 'icon-192.png', size: 192, mark: 1, fill: null },
  { file: 'icon-512.png', size: 512, mark: 1, fill: null },
  { file: 'maskable-192.png', size: 192, mark: 0.8, fill: background },
  { file: 'maskable-512.png', size: 512, mark: 0.8, fill: background },
]

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
)
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const { file, size, mark, fill } of icons) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><style>
      html, body { margin: 0; width: ${size}px; height: ${size}px;
        background: ${fill ?? 'transparent'}; }
      body { display: grid; place-items: center; }
      svg { display: block; width: ${Math.round(size * mark)}px; height: auto; }
    </style>${svg}`,
  )
  await page.screenshot({
    path: join(outDir, file),
    omitBackground: fill === null,
  })
  console.log(`wrote ${file}`)
}
await browser.close()
