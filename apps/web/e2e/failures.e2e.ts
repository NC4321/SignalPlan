import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

// Failures (D91): a broken worker, storage that's full or blocked, and a
// crash in the editor. Each says what happened and what to try.

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

/**
 * Makes the app's workers fail: any created while `window.__broken` holds
 * their name ('engine', 'placement' or 'calibration') throws as soon as they
 * get a message.
 */
async function breakableWorkers(page: Page, broken: string[]) {
  await page.addInitScript((names) => {
    const w = window as unknown as { __broken: Set<string>; Worker: unknown }
    w.__broken = new Set(names)
    const Native = window.Worker
    w.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        const text = String(url)
        if ([...w.__broken].some((name) => text.includes(name))) {
          const script = 'self.onmessage = () => { throw new Error("boom") }'
          const blob = new Blob([script], { type: 'text/javascript' })
          super(URL.createObjectURL(blob))
        } else super(url, options)
      }
    }
  }, broken)
}

const mendWorkers = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __broken: Set<string> }).__broken.clear(),
  )

async function moveRouter(page: Page) {
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Shift+ArrowRight')
}

test.describe('a worker fails', () => {
  test('coverage says so, and Try again brings the heatmap back', async ({
    page,
  }) => {
    await breakableWorkers(page, ['engine'])
    await page.goto('/')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Couldn’t work out coverage: boom')
    await expect(alert).toContainText('Try again')
    await expect(page.locator('.editor-canvas')).toBeVisible()

    await mendWorkers(page)
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(alert).toHaveCount(0)
    await expect(page.locator('.coverage-status')).toHaveText(/^86% of/)
  })

  test('the optimizer shows it where its result would be', async ({ page }) => {
    await breakableWorkers(page, ['placement'])
    await openEditor(page)
    await panel(page)
      .getByRole('button', { name: 'Find a better spot for Wi-Fi 6E router' })
      .click()
    await expect(panel(page).locator('.optimizer-status')).toHaveText(
      'Couldn’t search: boom. Try again; if it keeps failing, reload the page.',
    )

    await mendWorkers(page)
    await panel(page)
      .getByRole('button', { name: 'Find a better spot for Wi-Fi 6E router' })
      .click()
    await expect(panel(page).locator('.optimizer-status')).toContainText(
      '86% → 92% of the floor',
    )
  })

  test('calibration shows it in the Calibrate panel', async ({ page }) => {
    await breakableWorkers(page, ['calibration'])
    await openEditor(page)
    const surveyed = readFileSync(
      fileURLToPath(
        new URL(
          '../../../packages/floorplan/fixtures/surveyed-home.json',
          import.meta.url,
        ),
      ),
      'utf8',
    )
    await page.getByLabel('Open a plan file').setInputFiles({
      name: 'surveyed-home.json',
      mimeType: 'application/json',
      buffer: Buffer.from(surveyed),
    })
    await panel(page).getByRole('button', { name: 'Calibrate' }).click()
    const failure = panel(page).getByRole('alert')
    await expect(failure).toHaveText(
      'Couldn’t calibrate: boom. Try again; if it keeps failing, reload the page.',
    )

    await mendWorkers(page)
    await panel(page).getByRole('button', { name: 'Try again' }).click()
    await expect(
      panel(page).getByRole('region', { name: '5 GHz calibration' }),
    ).toContainText('RMS error')
    await expect(failure).toHaveCount(0)
  })
})

test.describe('storage', () => {
  test('full: one steady notice, and saving resumes when there’s room', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __full: boolean }
      w.__full = true
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (w.__full) throw new DOMException('full', 'QuotaExceededError')
        return put.apply(this, args)
      }
    })
    await openEditor(page)
    const notice = page.locator('.storage-notice')
    await expect(notice).toBeHidden()

    await moveRouter(page)
    await expect(notice).toContainText(
      'Your changes aren’t being saved in this browser: its storage is full.',
    )
    await expect(notice).toContainText('File › Save to file')

    // More edits don't add or flicker the notice.
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(notice).toHaveCount(1)
    await expect(notice).toBeVisible()

    await page.evaluate(() => {
      ;(window as unknown as { __full: boolean }).__full = false
    })
    await notice.getByRole('button', { name: 'Try saving again' }).click()
    await expect(notice).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved in this browser' }),
    ).toBeVisible()
  })

  test('blocked: says so as soon as the app opens', async ({ page }) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException('blocked', 'SecurityError')
      }
    })
    await openEditor(page)
    const notice = page.locator('.storage-notice')
    await expect(notice).toContainText(
      'it’s blocking storage, as a private window often does.',
    )
    await expect(notice).toContainText('File › Save to file')
    // Nothing to retry, but the editor works.
    await expect(
      notice.getByRole('button', { name: 'Try saving again' }),
    ).toHaveCount(0)
    await moveRouter(page)
    await expect(notice).toBeVisible()
  })
})

test.describe('the editor crashes', () => {
  test('offers the plan as a file before reloading', async ({ page }) => {
    // Once armed, formatting a length throws, which the status bar does as
    // soon as the pointer moves over the plan.
    await page.addInitScript(() => {
      const w = window as unknown as { __crash: boolean }
      const toFixed = Number.prototype.toFixed
      Number.prototype.toFixed = function (this: number, digits?: number) {
        if (w.__crash) throw new Error('the screen broke')
        return toFixed.call(this, digits)
      }
    })
    await openEditor(page)
    await moveRouter(page)
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved in this browser' }),
    ).toBeVisible()
    await page.evaluate(() => {
      ;(window as unknown as { __crash: boolean }).__crash = true
    })
    const canvas = (await page.locator('.editor-canvas').boundingBox())!
    await page.mouse.move(canvas.x + 200, canvas.y + 200)
    await page.mouse.move(canvas.x + 240, canvas.y + 230)

    const crash = page.getByRole('alert')
    await expect(crash).toContainText('SignalPlan stopped working')
    await expect(page.locator('.editor-canvas')).toHaveCount(0)
    await expect(crash.locator('details')).not.toHaveAttribute('open', '')
    await crash.getByText('What went wrong').click()
    await expect(crash.locator('pre')).toHaveText('the screen broke')

    const download = page.waitForEvent('download')
    await crash.getByRole('button', { name: 'Download your plan' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('Sample bungalow.signalplan.json')
    const path = await file.path()
    const plan = JSON.parse(readFileSync(path, 'utf8'))
    // The plan as it was when the editor stopped, router moved included.
    expect(plan.accessPoints[0].x).toBeCloseTo(6.1, 5)
    await expect(crash).toContainText('Your plan was saved as a file')

    await page.evaluate(() => {
      ;(window as unknown as { __crash: boolean }).__crash = false
    })
    await crash.getByRole('button', { name: 'Reload SignalPlan' }).click()
    await expect(page.locator('.editor-canvas[data-scale]')).toBeVisible()
  })
})
