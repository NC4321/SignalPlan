/**
 * Draws the install icons in apps/web/public/icons from
 * apps/web/public/favicon.svg, for the web app manifest (D98):
 *
 *   icon-192.png, icon-512.png          the mark on a transparent square
 *   maskable-192.png, maskable-512.png  the mark inside the safe zone on the
 *                                       app's background, for launchers that
 *                                       crop icons to a circle or squircle
 *   apple-touch-icon.png                180 px on the background (iOS fills
 *                                       transparency with black)
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
// The dark theme's --surface in index.css, as in the manifest.
const background = '#1f1e24'

// The mark's share of the icon's width. A maskable icon keeps its content in
// the middle 80% circle; at 56% even a square mark's corners stay inside it.
const icons = [
  { file: 'icon-192.png', size: 192, mark: 0.86, fill: null },
  { file: 'icon-512.png', size: 512, mark: 0.86, fill: null },
  { file: 'maskable-192.png', size: 192, mark: 0.56, fill: background },
  { file: 'maskable-512.png', size: 512, mark: 0.56, fill: background },
  { file: 'apple-touch-icon.png', size: 180, mark: 0.7, fill: background },
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
      svg { width: ${Math.round(size * mark)}px; height: auto; }
    </style>${svg}`,
  )
  await page.screenshot({
    path: join(outDir, file),
    omitBackground: fill === null,
  })
  console.log(`wrote ${file}`)
}
await browser.close()
