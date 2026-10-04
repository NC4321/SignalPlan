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
    await expect(alert).toContainText(
      'Couldn’t work out coverage for this plan. Try again; if it keeps failing, reload the page.',
    )
    // The raw reason is there, but out of the way.
    await expect(alert.locator('details')).not.toHaveAttribute('open', '')
    await expect(alert.locator('pre')).toBeHidden()
    await alert.getByText('Details').click()
    await expect(alert.locator('pre')).toHaveText('boom')
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
      'Couldn’t search for a spot. Try again; if it keeps failing, reload the page.',
    )
    await expect(panel(page).locator('.failure-details')).toContainText(
      'Details',
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
    await expect(failure).toContainText(
      'Couldn’t calibrate. Try again; if it keeps failing, reload the page.',
    )

    await mendWorkers(page)
    await panel(page).getByRole('button', { name: 'Try again' }).click()
    await expect(
      panel(page).getByRole('region', { name: '5 GHz calibration' }),
    ).toContainText('RMS error')
    await expect(failure).toHaveCount(0)
  })
})

test.describe('a worker can’t load', () => {
  test('a missing worker script shows the same panel', async ({ page }) => {
    await page.route('**/engine.worker*', (route) =>
      route.fulfill({ status: 404, body: 'Not found' }),
    )
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText(
      'Couldn’t work out coverage for this plan.',
    )
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.locator('.editor-canvas')).toBeVisible()
  })

  test('a worker script with a syntax error does too', async ({ page }) => {
    await page.route('**/engine.worker*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'this is not (valid javascript',
      }),
    )
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText(
      'Couldn’t work out coverage for this plan.',
    )
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
    await expect(notice).toHaveText(
      /^Changes aren’t being saved: this browser’s storage is full\. Use File › Save to file\./,
    )

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

  test('a later failure says so, says when a retry fails too, and clears', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __broken: boolean }
      w.__broken = true
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (w.__broken) throw new DOMException('odd', 'UnknownError')
        return put.apply(this, args)
      }
    })
    await openEditor(page)
    const notice = page.locator('.storage-notice')
    await moveRouter(page)
    await expect(notice).toHaveText(
      /^Couldn’t save your last changes in this browser\. Use File › Save to file to keep a copy\./,
    )
    await expect(notice).not.toContainText('Still couldn’t save')

    await notice.getByRole('button', { name: 'Try saving again' }).click()
    await expect(notice).toContainText('Still couldn’t save.')

    await page.evaluate(() => {
      ;(window as unknown as { __broken: boolean }).__broken = false
    })
    await notice.getByRole('button', { name: 'Try saving again' }).click()
    await expect(notice).toHaveCount(0)
  })

  test('blocked: says so as soon as the app opens', async ({ page }) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException('blocked', 'SecurityError')
      }
    })
    await openEditor(page)
    const notice = page.locator('.storage-notice')
    await expect(notice).toHaveText(
      'Changes aren’t being saved: this browser is blocking storage. Use File › Save to file.',
    )
    // Nothing to retry, but the editor works.
    await expect(
      notice.getByRole('button', { name: 'Try saving again' }),
    ).toHaveCount(0)
    await moveRouter(page)
    await expect(notice).toBeVisible()
  })
})

test.describe('the editor crashes', () => {
  /** Edits the plan once saved, then crashes the next render. */
  async function crash(page: Page) {
    await openEditor(page)
    await moveRouter(page)
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved in this browser' }),
    ).toBeVisible()
    await page.evaluate(() => {
      ;(
        window as unknown as { __signalplanCrashOnRender: boolean }
      ).__signalplanCrashOnRender = true
    })
    await page.keyboard.press('Shift+ArrowRight')
    return page.getByRole('main').filter({ hasText: 'SignalPlan stopped' })
  }

  test('offers the plan as a file before reloading', async ({ page }) => {
    const crashed = await crash(page)
    await expect(
      crashed.getByRole('heading', { name: 'SignalPlan stopped working' }),
    ).toBeFocused()
    await expect(crashed.getByRole('alert')).toContainText(
      'Something went wrong while drawing the screen',
    )
    await expect(page.locator('.editor-canvas')).toHaveCount(0)
    await expect(crashed.locator('details')).not.toHaveAttribute('open', '')
    await crashed.getByText('What went wrong').click()
    await expect(crashed.locator('pre')).toHaveText(
      'Crash on render, as asked.',
    )

    const download = page.waitForEvent('download')
    await crashed.getByRole('button', { name: 'Download your plan' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('Sample bungalow.signalplan.json')
    const plan = JSON.parse(readFileSync((await file.path())!, 'utf8'))
    // The plan as it was when the editor stopped, with both moves in it.
    expect(plan.accessPoints[0].x).toBeCloseTo(6.6, 5)
    await expect(crashed).toContainText('Your plan was saved as a file')
  })

  test('reload opens the sample, and the plan is still in My plans', async ({
    page,
  }) => {
    const crashed = await crash(page)
    // Longer than the autosave delay: nothing may save the crashing plan.
    await page.waitForTimeout(800)
    await crashed.getByRole('button', { name: 'Reload SignalPlan' }).click()
    await page.locator('.editor-canvas[data-scale]').waitFor()
    await expect(page.locator('.status-notice')).toHaveText(
      'SignalPlan reloaded with the sample home after a problem. Your plan is still in My plans.',
    )
    await page.getByText('File', { exact: true }).click()
    await page.getByRole('button', { name: 'My plans…' }).click()
    const dialog = page.getByRole('dialog', { name: 'My plans' })
    await expect(dialog.getByText('Sample bungalow')).toBeVisible()
    await expect(dialog.locator('.plan-list li')).toHaveCount(1)
  })
})
