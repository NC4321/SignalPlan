import { expect, test, type Page } from '@playwright/test'

// Offline use behind a switch (D98). The server is the production build, so
// the service worker is the one that ships.

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const share = (page: Page) => panel(page).locator('.coverage-share')
const SAMPLE_SHARE = '86% of 150 m² at Fair or better on 5 GHz.'

async function waitForEditor(page: Page) {
  await page.locator('.editor-canvas[data-scale]').waitFor({ state: 'visible' })
}

const manifestLinks = (page: Page) => page.locator('link[rel="manifest"]')

const registrations = (page: Page) =>
  page.evaluate(
    async () => (await navigator.serviceWorker.getRegistrations()).length,
  )

const ownCaches = (page: Page) =>
  page.evaluate(async () =>
    (await caches.keys()).filter((key) => key.startsWith('signalplan-')),
  )

/** Turns offline use on and waits until the worker has cached the app. */
async function turnOn(page: Page) {
  await page.goto('/?offline=on')
  await waitForEditor(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
}

test('is off by default: no manifest, no service worker', async ({ page }) => {
  await page.goto('/')
  await waitForEditor(page)
  await expect(share(page)).toHaveText(SAMPLE_SHARE)
  await expect(manifestLinks(page)).toHaveCount(0)
  expect(await registrations(page)).toBe(0)
  expect(await ownCaches(page)).toEqual([])
  await expect(page.locator('.status-notice')).not.toContainText('offline')
})

test('?offline=on installs it, and the app then works offline', async ({
  page,
  context,
}) => {
  await turnOn(page)
  // The parameter is taken out of the address bar.
  expect(new URL(page.url()).search).toBe('')
  await expect(manifestLinks(page)).toHaveCount(1)
  await expect(manifestLinks(page)).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  expect(await registrations(page)).toBe(1)
  expect(await ownCaches(page)).toHaveLength(1)
  expect(
    await page.evaluate(() => localStorage.getItem('signalplan:offline')),
  ).toBe('on')
  await expect(page.locator('.status-notice')).toHaveText(
    'SignalPlan now works offline in this browser.',
  )
  // The manifest and its icons are served.
  const manifest = await (
    await page.request.get('/manifest.webmanifest')
  ).json()
  expect(manifest).toMatchObject({ name: 'SignalPlan', display: 'standalone' })
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(icon.src)).ok()).toBe(true)
  }

  await context.setOffline(true)
  await page.reload()
  await waitForEditor(page)
  // The coverage worker runs from the cache.
  await expect(share(page)).toHaveText(SAMPLE_SHARE)
  // So does the lazily loaded 3D view.
  await page
    .getByRole('group', { name: 'View' })
    .locator('label', { hasText: '3D' })
    .click()
  await expect(page.locator('.view3d-canvas canvas')).toBeVisible()
  await expect(
    page
      .getByRole('list', { name: 'Floors in the 3D view' })
      .getByRole('listitem'),
  ).toHaveText([/^Main floor, at 0\.00 m: 22 walls.* 86% of 150 m²/])
  // Still on after the reload, with the manifest linked again.
  await expect(manifestLinks(page)).toHaveCount(1)
})

test('?offline=off removes the worker and its caches', async ({ page }) => {
  await turnOn(page)
  expect(await registrations(page)).toBe(1)

  await page.goto('/?offline=off')
  await waitForEditor(page)
  await expect(page.locator('.status-notice')).toHaveText(
    'Offline use is off in this browser.',
  )
  expect(new URL(page.url()).search).toBe('')
  await expect(manifestLinks(page)).toHaveCount(0)
  await expect.poll(() => registrations(page)).toBe(0)
  await expect.poll(() => ownCaches(page)).toEqual([])
  expect(
    await page.evaluate(() => localStorage.getItem('signalplan:offline')),
  ).toBe('off')

  // And it stays off on the next visit.
  await page.goto('/')
  await waitForEditor(page)
  await expect(manifestLinks(page)).toHaveCount(0)
  expect(await registrations(page)).toBe(0)
})
