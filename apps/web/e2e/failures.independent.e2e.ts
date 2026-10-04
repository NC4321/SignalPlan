/**
 * Independent checks of D93 (issue #159, slice C), written from the
 * requirement rather than the implementation: each failure says what
 * happened and what to try, never leaves a blank area, and a failed open or
 * import never loses or changes the plan that was open.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickPlan, openEditor, summaryCount } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const planTitle = (page: Page) =>
  panel(page).getByRole('heading', { level: 2 }).first()
const coverageLine = (page: Page) => panel(page).locator('.coverage-share')
const viewSwitch = (page: Page, label: '2D' | '3D') =>
  page.getByRole('group', { name: 'View' }).locator('label', { hasText: label })

/** Fails on serious or critical axe-core findings, listing them. */
async function expectNoSeriousViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page })
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    )
  expect(serious).toEqual([])
}

/** Text a person can read: says something, and isn't a leaked error. */
async function expectReadable(locator: Locator) {
  await expect(locator).toBeVisible()
  const text = (await locator.innerText()).trim()
  expect(text.length).toBeGreaterThan(30)
  expect(text).not.toMatch(/\[object Object\]|undefined|NaN/)
  expect(text).not.toMatch(/\bat \S+ \(|\.tsx?:\d+|\.js:\d+|TypeError|Error:/)
}

/** Edits the sample so it's the user's own plan (and joins My plans). */
async function makeItMine(page: Page) {
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved' }),
  ).toHaveText('Saved in this browser')
  await page.keyboard.press('Escape')
}

/** The open plan, exactly, as Save to file writes it. */
async function planSnapshot(page: Page): Promise<unknown> {
  await page.locator('.editor-canvas').focus()
  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const file = await download
  const chunks = await (await file.createReadStream()).toArray()
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** The names in My plans. */
async function myPlans(page: Page): Promise<string[]> {
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'My plans…' }).click()
  const dialog = page.getByRole('dialog', { name: 'My plans' })
  await expect(
    dialog.getByRole('button', { name: /^Open / }).first(),
  ).toBeVisible()
  const names = await dialog
    .getByRole('button', { name: /^Open / })
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute('aria-label') ?? ''),
    )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return names.sort()
}

/** What shows that the plan is the one it was. */
async function planState(page: Page) {
  return {
    title: await planTitle(page).textContent(),
    walls: await summaryCount(page, 'Walls'),
    coverage: await coverageLine(page).textContent(),
  }
}

/** Opens a file through File › Open file…, as a person would. */
async function openPlanFile(page: Page, name: string, buffer: Buffer) {
  await page.getByText('File', { exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Open file…/ }).click()
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer })
}

const futurePlan = JSON.stringify({
  schemaVersion: 9999,
  name: 'From the future',
  floors: [
    {
      id: 'f',
      name: 'Floor',
      elevationM: 0,
      heightM: 2.5,
      nodes: [],
      walls: [],
      openings: [],
    },
  ],
  accessPoints: [],
})

const unreadable: { what: string; name: string; buffer: Buffer }[] = [
  {
    what: 'binary garbage named .json',
    name: 'garbage.json',
    buffer: Buffer.from(
      Array.from({ length: 2048 }, (_, i) => (i * 97 + 13) % 256),
    ),
  },
  {
    what: 'a valid JSON array',
    name: 'array.json',
    buffer: Buffer.from('[1, 2, {"walls": []}]'),
  },
  {
    what: 'a plan from a far newer version',
    name: 'future.signalplan.json',
    buffer: Buffer.from(futurePlan),
  },
  { what: 'an empty file', name: 'empty.json', buffer: Buffer.alloc(0) },
]

test.describe('opening a file that can’t be opened', () => {
  for (const file of unreadable) {
    for (const dismiss of ['Escape', 'button'] as const) {
      test(`${file.what}, dismissed with ${dismiss}`, async ({ page }) => {
        await openEditor(page)
        await makeItMine(page)
        const before = await planState(page)
        const snapshot = await planSnapshot(page)
        const plans = await myPlans(page)

        await openPlanFile(page, file.name, file.buffer)
        const dialog = page.getByRole('dialog', {
          name: 'This file can’t be opened',
        })
        await expectReadable(dialog)
        // It names the file, and says what to try.
        await expect(dialog).toContainText(file.name)
        await expect(dialog).toContainText(/try/i)

        if (dismiss === 'Escape') await page.keyboard.press('Escape')
        else await dialog.getByRole('button', { name: 'OK' }).click()
        await expect(dialog).toBeHidden()

        // Focus lands somewhere a keyboard user can carry on from.
        const focused = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return 'body'
          const box = el.getBoundingClientRect()
          return box.width > 0 && box.height > 0 ? 'visible' : 'hidden'
        })
        expect(focused).toBe('visible')

        // The plan is still open and exactly as it was; nothing was added.
        expect(await planState(page)).toEqual(before)
        expect(await planSnapshot(page)).toEqual(snapshot)
        expect(await myPlans(page)).toEqual(plans)
      })
    }
  }

  test('the dialog passes axe', async ({ page }) => {
    await openEditor(page)
    await openPlanFile(page, 'garbage.json', unreadable[0]!.buffer)
    await expect(
      page.getByRole('dialog', { name: 'This file can’t be opened' }),
    ).toBeVisible()
    await expectNoSeriousViolations(page)
  })
})

test('a broken shared link leaves the open plan as it was', async ({
  page,
}) => {
  await openEditor(page)
  await makeItMine(page)
  const before = await planState(page)
  const snapshot = await planSnapshot(page)
  await page.evaluate(() => {
    window.location.hash = '#plan=1.this-is-not-a-plan'
  })
  const dialog = page.getByRole('dialog', { name: 'This link can’t be opened' })
  await expectReadable(dialog)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await planState(page)).toEqual(before)
  expect(await planSnapshot(page)).toEqual(snapshot)
})

test('importing a garbage readings file imports nothing', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('s')
  await clickPlan(page, 3, 4)
  await expect(
    panel(page).getByRole('heading', { name: 'Spot 1' }),
  ).toBeVisible()
  const snapshot = await planSnapshot(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  const undoTitle = await undo.getAttribute('title')

  await page.getByText('File', { exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Import readings…' })
    .click()
  await (
    await chooser
  ).setFiles({
    name: 'junk.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\u0000\u0001zz;;"\n,,,\n%%%,"unterminated\n��'),
  })
  const dialog = page.getByRole('dialog', {
    name: 'These readings can’t be imported',
  })
  await expectReadable(dialog)
  await expect(dialog).toContainText('junk.csv')
  await expectNoSeriousViolations(page)
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(dialog).toBeHidden()

  await expect(undo).toHaveAttribute('title', undoTitle ?? '')
  expect(await planSnapshot(page)).toEqual(snapshot)
})

test.describe('Scan your network', () => {
  /** A scan from nmcli, as in packages/floorplan/fixtures/scans. */
  const NMCLI = [
    'A4\\:2B\\:B0\\:12\\:34\\:56:HomeNet:36:5180 MHz:86',
    'A4\\:2B\\:B0\\:12\\:34\\:55:HomeNet:6:2437 MHz:100',
    '10\\:20\\:30\\:40\\:50\\:60:Next\\: door:149:5745 MHz:30',
  ].join('\n')

  test('nonsense says what to try, and a good scan still works after', async ({
    page,
  }) => {
    await openEditor(page)
    const snapshot = await planSnapshot(page)
    await page.getByText('File', { exact: true }).click()
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Scan your network…' })
      .click()
    const reader = page.getByRole('dialog', { name: 'Scan your network' })
    const output = reader.getByRole('textbox', { name: 'What it printed' })
    await output.fill('lorem ipsum {"not": "a scan"} 12:34 ???')
    await reader.getByRole('button', { name: 'Read scan' }).click()

    const alert = reader.getByRole('alert')
    await expectReadable(alert)
    // What to try: copy or run it again.
    await expect(alert).toContainText(/try|again|copy|run/i)
    await expectNoSeriousViolations(page)
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true)

    // The dialog is still usable: a good scan reads.
    await output.fill(NMCLI)
    await reader.getByRole('button', { name: 'Read scan' }).click()
    const answers = page.getByRole('dialog', {
      name: 'Which networks are yours?',
    })
    await expect(answers).toContainText('Read 3 BSSIDs')
    await answers.getByRole('button', { name: 'Cancel' }).click()
    await expect(answers).toBeHidden()

    expect(await planSnapshot(page)).toEqual(snapshot)
  })
})

test('a text file named .png gives a message and places no image', async ({
  page,
}) => {
  await openEditor(page)
  const snapshot = await planSnapshot(page)
  await page.getByText('File', { exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Trace a floor plan image…' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'plan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('This is not an image, just some text.\n'),
  })
  const dialog = page.getByRole('dialog', { name: 'This image can’t be used' })
  await expectReadable(dialog)
  await expect(dialog).toContainText(/try/i)
  await expectNoSeriousViolations(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // No image was placed: no tracing section, no calibration, same plan.
  await expect(
    panel(page).getByRole('region', { name: 'Tracing image' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Calibrate the image' }),
  ).toHaveCount(0)
  expect(await planSnapshot(page)).toEqual(snapshot)
})

test.describe('the 3D view', () => {
  test('without WebGL says so, with a way back to the 2D map', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null
        return (original as (...a: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        )
      } as typeof original
    })
    await openEditor(page)
    await viewSwitch(page, '3D').click()

    const stage = page.getByRole('main')
    const alert = stage.getByRole('alert')
    await expectReadable(alert)
    await expect(alert).toContainText(/WebGL/)
    // Never blank: the area where the 3D view would be has text.
    expect((await stage.innerText()).trim().length).toBeGreaterThan(30)
    await expectNoSeriousViolations(page)

    await alert.getByRole('button', { name: /2D/ }).click()
    await expect(alert).toBeHidden()
    const canvas = page.locator('.editor-canvas')
    await expect(canvas).toBeVisible()
    // The heatmap is there: the readout gives a signal.
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.readout')).toContainText(/-\d+ dBm/)
  })

  test('says it is loading while its code arrives', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/assets\/View3D[^/]*\.js$/, async (route) => {
      await held
      await route.continue()
    })
    await openEditor(page)
    await viewSwitch(page, '3D').click()
    const stage = page.getByRole('main')
    await expect(stage.getByRole('status')).toContainText(/Loading/)
    release()
    // Then the view itself, or a message: never nothing.
    await expect(
      stage.locator('.view3d-canvas canvas').or(stage.getByRole('alert')),
    ).toBeVisible()
  })

  test('when its code can’t be fetched, says so, not a blank area', async ({
    page,
  }) => {
    await page.route(/\/assets\/View3D[^/]*\.js$/, (route) => route.abort())
    await openEditor(page)
    await viewSwitch(page, '3D').click()
    const stage = page.getByRole('main')
    const alert = stage.getByRole('alert')
    await expectReadable(alert)
    await alert.getByRole('button', { name: /2D/ }).click()
    await expect(page.locator('.editor-canvas')).toBeVisible()
  })
})
