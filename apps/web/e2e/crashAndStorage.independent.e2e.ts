import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AxeBuilder } from '@axe-core/playwright'
import { devices, expect, test, type Page } from '@playwright/test'
import { openEditor, screenPoint } from './helpers.ts'

/*
 * Independent tests for D91 (#159, slice A), written against the issue's
 * requirements rather than the implementation: every failure says what
 * happened and what to try and never leaves a blank area; a top-level error
 * boundary offers the plan as a file before reloading; nothing the user did
 * is lost.
 *
 * Failures are forced from outside the app with init scripts, so the app's
 * own code runs unchanged:
 * - a render crash: `Number.prototype.toFixed` throws while a flag is set, and
 *   the pointer readout (rendered by React) formats lengths with it;
 * - a worker failure: `window.Worker` swaps in a worker that throws on its
 *   first message, for the worker scripts named in `__brokenWorkers`;
 * - storage full: `IDBObjectStore.prototype.put` throws QuotaExceededError
 *   while a flag is set;
 * - storage blocked: `indexedDB.open` throws SecurityError from the start.
 */

declare global {
  interface Window {
    __crashRender?: boolean
    __brokenWorkers?: Set<string>
    __storageFull?: boolean
  }
}

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const stage = (page: Page) => page.getByRole('main')
const canvas = (page: Page) => page.locator('.editor-canvas')
const coverageStatus = (page: Page) => page.locator('.coverage-status')
const planNameField = (page: Page) => panel(page).getByLabel('Plan name')

/** What to try: again, reload, or save to a file. */
const WHAT_TO_TRY = /try again|reload|save (it )?to (a )?file/i

/** Fails on serious or critical axe-core findings, listing them. */
async function expectNoSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    )
  expect(serious).toEqual([])
}

async function renamePlan(page: Page, name: string) {
  await planNameField(page).fill(name)
  await planNameField(page).press('Enter')
  await expect(
    panel(page).getByRole('heading', { level: 2, name, exact: true }),
  ).toBeVisible()
}

// --- Render crash --------------------------------------------------------

async function armRenderCrash(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const toFixed = Number.prototype.toFixed
    Number.prototype.toFixed = function (this: number, digits?: number) {
      if (window.__crashRender) throw new Error('Forced render crash (test)')
      return toFixed.call(this, digits)
    }
  })
}

/** Makes the editor re-render the pointer readout, which then throws. */
async function crashNow(page: Page) {
  const a = await screenPoint(page, 2, 2)
  // Any re-render from here on throws (a status change can get there first).
  await page.evaluate(() => (window.__crashRender = true))
  await page.mouse.move(a.x, a.y)
  await page.mouse.move(a.x + 15, a.y + 10)
}

const crashHeading = (page: Page) => page.getByRole('heading', { level: 1 })

test.describe('top-level error boundary', () => {
  test('a render crash shows what happened and offers the current plan as a file', async ({
    page,
  }) => {
    await armRenderCrash(page)
    await openEditor(page)
    // The edit made just before the crash, so the autosaved copy (saved
    // shortly after an edit) may well not have it yet.
    await renamePlan(page, 'Rescued before the crash')
    await crashNow(page)

    // Not a blank page: a heading and an explanation saying what to do.
    await expect(crashHeading(page)).toBeVisible()
    await expect(crashHeading(page)).not.toHaveText('')
    await expect(canvas(page)).toHaveCount(0)
    const body = page.locator('body')
    await expect(body).toContainText(/went wrong|stopped|crashed|error/i)
    await expect(body).toContainText(/download/i)
    await expect(body).toContainText(/reload/i)

    // The crash is over; rescuing the plan isn't part of what broke.
    await page.evaluate(() => (window.__crashRender = false))

    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: /download/i }).click()
    const download = await downloading
    const path = await download.path()
    const file = JSON.parse(readFileSync(path, 'utf8')) as {
      schemaVersion?: unknown
      name?: unknown
      floors?: { walls?: unknown[] }[]
    }
    expect(typeof file.schemaVersion).toBe('number')
    expect(file.name).toBe('Rescued before the crash')
    // The sample home, walls and all, not an empty plan.
    expect(file.floors?.[0]?.walls?.length ?? 0).toBeGreaterThan(0)
    expect(download.suggestedFilename()).toMatch(/\.json$/)

    // Reload brings back a working editor, with the edit kept.
    await page.getByRole('button', { name: /reload/i }).click()
    await canvas(page).waitFor({ state: 'visible' })
    await expect(page.locator('.editor-canvas[data-scale]')).toBeVisible()
    await expect(planNameField(page)).toHaveValue('Rescued before the crash')
    await expect(coverageStatus(page)).toHaveText(/^\d+% of/)
    // And the editor works: another edit goes through.
    await renamePlan(page, 'Working again')
  })

  test('the crash screen has no serious accessibility problems', async ({
    page,
  }) => {
    await armRenderCrash(page)
    await openEditor(page)
    await crashNow(page)
    await expect(crashHeading(page)).toBeVisible()
    await page.evaluate(() => (window.__crashRender = false))
    await expectNoSeriousViolations(page)
  })
})

// --- Worker failures -----------------------------------------------------

/** Workers whose script URL names one of `kinds` throw on their first job. */
async function breakWorkers(page: Page, kinds: string[]) {
  await page.addInitScript((initial: string[]) => {
    window.__brokenWorkers = new Set(initial)
    const Real = window.Worker
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        const href = String(url)
        const broken = [...window.__brokenWorkers!].some((kind) =>
          href.includes(`${kind}.worker`),
        )
        if (!broken) {
          super(url, options)
          return
        }
        const script =
          "self.onmessage = () => { throw new Error('Simulated worker crash') }"
        super(
          URL.createObjectURL(new Blob([script], { type: 'text/javascript' })),
        )
      }
    }
  }, kinds)
}

async function fixWorkers(page: Page) {
  await page.evaluate(() => window.__brokenWorkers!.clear())
}

/** Nothing on the map is left spinning. */
async function expectNotBusy(page: Page) {
  await expect(
    stage(page).locator('[aria-busy="true"], [role="progressbar"]'),
  ).toHaveCount(0)
}

const surveyed = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../packages/floorplan/fixtures/surveyed-home.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as unknown

test.describe('worker failures', () => {
  test('a failed coverage worker says so over the map, and Try again brings the heatmap back', async ({
    page,
  }) => {
    await breakWorkers(page, ['engine'])
    await openEditor(page)

    const failure = stage(page)
      .getByRole('alert')
      .filter({ hasText: /coverage/i })
    await expect(failure).toBeVisible()
    await expect(failure).toContainText(/couldn.t|failed|stopped/i)
    await expect(failure).toContainText(WHAT_TO_TRY)
    const retry = failure.getByRole('button', { name: /try again|retry/i })
    await expect(retry).toBeEnabled()
    // The plan is still drawn underneath: not a blank map, not a spinner.
    await expect(canvas(page)).toBeVisible()
    await expectNotBusy(page)
    await expect(coverageStatus(page)).not.toHaveText(/^\d+% of/)

    // Retrying while still broken fails the same way, once.
    await retry.click()
    await expect(failure).toHaveCount(1)
    await expect(failure).toBeVisible()

    await fixWorkers(page)
    await failure.getByRole('button', { name: /try again|retry/i }).click()
    await expect(failure).toHaveCount(0)
    await expect(coverageStatus(page)).toHaveText(/^86% of/)
  })

  test('a failed optimizer says so where the suggestion would be, and can be run again', async ({
    page,
  }) => {
    await breakWorkers(page, ['placement'])
    await openEditor(page)
    await expect(coverageStatus(page)).toHaveText(/^86% of/)
    const find = panel(page).getByRole('button', {
      name: 'Find a better spot for Wi-Fi 6E router',
    })
    await find.click()

    const result = panel(page).locator('.optimizer-status')
    await expect(result).toContainText(/couldn.t|failed|stopped/i)
    await expect(result).toContainText(WHAT_TO_TRY)
    // Not stuck: no Cancel left behind, and the search can start again.
    await expect(find).toBeEnabled()
    await expect(
      panel(page).getByRole('button', { name: 'Cancel' }),
    ).toHaveCount(0)
    await expect(coverageStatus(page)).toHaveText(/^86% of/)

    await fixWorkers(page)
    await find.click()
    await expect(result).toContainText(
      '86% → 92% of the floor at Fair or better on 5 GHz.',
    )
  })

  test('a failed calibration says so where the result would be, and can be run again', async ({
    page,
  }) => {
    await breakWorkers(page, ['calibration'])
    await openEditor(page)
    await page.getByLabel('Open a plan file').setInputFiles({
      name: 'surveyed-home.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(surveyed)),
    })
    await expect(
      panel(page).getByRole('heading', { level: 2 }).first(),
    ).toHaveText('Surveyed bungalow')

    await panel(page).getByRole('button', { name: 'Calibrate' }).click()
    const section = panel(page)
      .getByRole('heading', { name: 'Calibrate the model' })
      .locator('xpath=..')
    const failure = section.getByRole('alert')
    await expect(failure).toContainText(/couldn.t|failed|stopped/i)
    await expect(failure).toContainText(WHAT_TO_TRY)
    // Not stuck on "Calibrating…": a button to run it again is enabled.
    await expect(
      section.getByRole('button', { name: /calibrating/i }),
    ).toHaveCount(0)
    const again = section.getByRole('button', {
      name: /try again|calibrate/i,
    })
    await expect(again.first()).toBeEnabled()

    await fixWorkers(page)
    await again.first().click()
    await expect(
      panel(page).getByRole('region', { name: '5 GHz calibration' }),
    ).toContainText(/RMS error/)
    await expect(failure).toHaveCount(0)
  })
})

// --- Storage full and blocked ---------------------------------------------

async function armStorageFull(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (window.__storageFull)
        throw new DOMException(
          'The quota has been exceeded.',
          'QuotaExceededError',
        )
      return put.apply(this, args)
    }
  })
}

async function blockStorage(page: Page) {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException(
        'The user denied permission to access the database.',
        'SecurityError',
      )
    }
  })
}

/**
 * Notices about storage on the page, outside the status bar's one-line save
 * status: live regions whose text mentions storage or saving.
 */
async function storageNoticeCount(page: Page, text: RegExp) {
  return page.evaluate(
    ({ source, flags }) => {
      const pattern = new RegExp(source, flags)
      const live = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="status"], [role="alert"], [aria-live]',
        ),
      ).filter(
        (el) =>
          !el.closest('footer') &&
          el.offsetParent !== null &&
          pattern.test(el.textContent ?? ''),
      )
      // Count outermost ones, so a region wrapping a message counts once.
      return live.filter(
        (el) => !live.some((other) => other !== el && other.contains(el)),
      ).length
    },
    { source: text.source, flags: text.flags },
  )
}

const storageNotice = (page: Page, text: RegExp) =>
  page
    .locator('[role="status"], [role="alert"]')
    .filter({ hasText: text })
    .and(page.locator(':not(footer *)'))

const FULL = /storage is full|storage.{0,20}full|out of (storage|space)/i

test.describe('storage full', () => {
  test('says once that changes aren’t saved, and saves again once there is room', async ({
    page,
  }) => {
    await armStorageFull(page)
    await openEditor(page)
    await page.evaluate(() => (window.__storageFull = true))

    await renamePlan(page, 'Full 1')
    const notice = storageNotice(page, FULL)
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/aren.t|not|won.t/i)
    await expect(notice).toContainText(/save (it )?to (a )?file/i)

    await renamePlan(page, 'Full 2')
    await page.waitForTimeout(700)
    await renamePlan(page, 'Full 3')
    await page.waitForTimeout(700)
    expect(await storageNoticeCount(page, FULL)).toBe(1)
    await expect(notice).toBeVisible()

    // Room again: another edit saves, and the notice goes.
    await page.evaluate(() => (window.__storageFull = false))
    await renamePlan(page, 'Saved after all')
    await expect(notice).toHaveCount(0)
    await page.reload()
    await canvas(page).waitFor({ state: 'visible' })
    await expect(planNameField(page)).toHaveValue('Saved after all')
  })

  test('Try again saves the plan once storage has room', async ({ page }) => {
    await armStorageFull(page)
    await openEditor(page)
    await page.evaluate(() => (window.__storageFull = true))
    await renamePlan(page, 'Kept by retrying')
    const notice = storageNotice(page, FULL)
    await expect(notice).toBeVisible()

    await page.evaluate(() => (window.__storageFull = false))
    await notice.getByRole('button', { name: /try|retry|save/i }).click()
    await expect(notice).toHaveCount(0)
    await page.reload()
    await canvas(page).waitFor({ state: 'visible' })
    await expect(planNameField(page)).toHaveValue('Kept by retrying')
  })

  // BUG (D91 storage-full state): the status bar's "Not saved: browser
  // storage is full. Save to a file." (.save-status[data-problem], #d55e00 on
  // the status bar) fails axe color-contrast (serious). It shows exactly when
  // the storage notice does.
  test.fixme('the storage notice has no serious accessibility problems', async ({
    page,
  }) => {
    await armStorageFull(page)
    await openEditor(page)
    await page.evaluate(() => (window.__storageFull = true))
    await renamePlan(page, 'Full for axe')
    await expect(storageNotice(page, FULL)).toBeVisible()
    await expectNoSeriousViolations(page)
  })
})

const BLOCKED =
  /aren.t being (saved|kept)|won.t be (saved|kept)|not (being )?(saved|kept)/i

test.describe('storage blocked', () => {
  test('the app still opens a usable plan and says changes won’t be kept', async ({
    page,
  }) => {
    await blockStorage(page)
    await openEditor(page)
    // A usable plan, not a blank page.
    await expect(coverageStatus(page)).toHaveText(/^86% of/)
    await expect(
      panel(page).getByRole('heading', { level: 2 }).first(),
    ).not.toHaveText('')

    const notice = storageNotice(page, BLOCKED)
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/save (it )?to (a )?file/i)

    // Editing still works, and the notice doesn't multiply.
    await renamePlan(page, 'Not kept 1')
    await page.waitForTimeout(700)
    await renamePlan(page, 'Not kept 2')
    await page.waitForTimeout(700)
    expect(await storageNoticeCount(page, BLOCKED)).toBe(1)
  })
})

// --- Phone ------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...pixel7 } = devices['Pixel 7']

test.describe('on a phone', () => {
  test.use(pixel7)

  test('the storage notice covers neither the top bar nor the map controls', async ({
    page,
  }) => {
    await armStorageFull(page)
    await openEditor(page)
    await page.evaluate(() => (window.__storageFull = true))
    await page.getByRole('button', { name: 'Details' }).click()
    await renamePlan(page, 'Full on a phone')
    await page.getByRole('button', { name: 'Details' }).click()
    await expect(page.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    const notice = storageNotice(page, FULL)
    await expect(notice).toBeVisible()
    await expect(notice).toBeInViewport()
    const box = (await notice.boundingBox())!
    const width = page.viewportSize()!.width
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5)
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    expect(scrollWidth).toBeLessThanOrEqual(width)

    const controls = page
      .locator('header.top-bar')
      .getByRole('button')
      .or(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button'))
      .or(page.getByRole('group', { name: 'Zoom' }).getByRole('button'))
    const count = await controls.count()
    expect(count).toBeGreaterThan(3)
    const overlaps: string[] = []
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i)
      if (!(await control.isVisible())) continue
      const b = (await control.boundingBox())!
      const overlap =
        b.x < box.x + box.width &&
        box.x < b.x + b.width &&
        b.y < box.y + box.height &&
        box.y < b.y + b.height
      if (overlap)
        overlaps.push(
          (await control.getAttribute('aria-label')) ??
            (await control.textContent()) ??
            `button ${i}`,
        )
    }
    expect(overlaps).toEqual([])
    // Each control is still the topmost thing where it's drawn, so it can be
    // tapped.
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i)
      if (!(await control.isVisible())) continue
      const onTop = await control.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        )
        return hit !== null && (el === hit || el.contains(hit))
      })
      expect(onTop).toBe(true)
    }
  })
})
