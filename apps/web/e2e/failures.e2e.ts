import { expect, test, type Page } from '@playwright/test'
import { openEditor, planImage } from './helpers.ts'

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })
const viewSwitch = (page: Page, label: '2D' | '3D') =>
  page.getByRole('group', { name: 'View' }).locator('label', { hasText: label })

test.describe('unreadable files and scans (D93)', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page)
  })

  const openFile = (page: Page, name: string, content: string | Buffer) =>
    page.getByLabel('Open a plan file').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    })

  test('a JSON file that isn’t a plan says so and what to try', async ({
    page,
  }) => {
    await openFile(page, 'notes.json', '{"hello": "world"}')
    const box = dialog(page, 'This file can’t be opened')
    await expect(box).toContainText('notes.json')
    await expect(box).toContainText('no valid schemaVersion')
    await expect(box).toContainText(
      'Nothing was opened and your plan is unchanged',
    )
    await box.getByRole('button', { name: 'OK' }).click()
    await expect(box).toBeHidden()
  })

  test('a plan from a newer version and a cut-off file are explained', async ({
    page,
  }) => {
    await openFile(page, 'newer.json', '{"schemaVersion": 99}')
    const box = dialog(page, 'This file can’t be opened')
    await expect(box).toContainText('newer')
    await box.getByRole('button', { name: 'OK' }).click()

    await openFile(page, 'cut.json', '{"schemaVersion": 1, "name": "Ho')
    await expect(box).toContainText('not valid JSON')
    await box.getByRole('button', { name: 'OK' }).click()
  })

  test('an empty file says it is empty', async ({ page }) => {
    await page.getByLabel('Open a plan file').setInputFiles({
      name: 'empty.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(0),
    })
    await expect(dialog(page, 'This file can’t be opened')).toContainText(
      'The file is empty',
    )
  })

  test('a file the browser can’t read says so', async ({ page }) => {
    await page.evaluate(() => {
      Blob.prototype.text = () => Promise.reject(new Error('read failed'))
    })
    await openFile(page, 'gone.json', '{"a":1}')
    await expect(dialog(page, 'This file can’t be opened')).toContainText(
      'The browser couldn’t read the file',
    )
  })

  test('a scan that nothing can read says what to paste instead', async ({
    page,
  }) => {
    await page.getByText('File', { exact: true }).click()
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Scan your network…' })
      .click()
    const reader = dialog(page, 'Scan your network')
    // Nothing pasted yet: the button is off, and the box says why.
    await expect(
      reader.getByRole('button', { name: 'Read scan' }),
    ).toBeDisabled()
    await expect(reader).toContainText('Paste what the command printed here')
    await reader
      .getByRole('textbox', { name: 'What it printed' })
      .fill('not a scan at all')
    await reader.getByRole('button', { name: 'Read scan' }).click()
    const alert = reader.getByRole('alert')
    await expect(alert).toContainText('isn’t a scan SignalPlan can read')
    await expect(alert).toContainText('Nothing was changed')
    await expect(alert).toContainText('Copy everything the command printed')
  })

  test('a scan file of the wrong kind or too big is explained', async ({
    page,
  }) => {
    await page.getByText('File', { exact: true }).click()
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Scan your network…' })
      .click()
    const reader = dialog(page, 'Scan your network')
    await page.getByLabel('Open a scan file').setInputFiles({
      name: 'photo.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('\u0000\u0001 binary-ish'),
    })
    await expect(reader.getByRole('alert')).toContainText(
      'isn’t a scan SignalPlan can read',
    )
    await page.getByLabel('Open a scan file').setInputFiles({
      name: 'huge.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(5_000_001, 'a'),
    })
    await expect(reader.getByRole('alert')).toContainText('5.0 MB')
  })

  test('a readings file that is empty says nothing was imported', async ({
    page,
  }) => {
    await page.getByLabel('Import readings').setInputFiles({
      name: 'empty.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(0),
    })
    const box = dialog(page, 'These readings can’t be imported')
    await expect(box).toContainText('Nothing was imported from “empty.csv”')
    await expect(box).toContainText('The file is empty')
  })

  test('a PDF or a broken image can’t be traced, and says what to try', async ({
    page,
  }) => {
    const choose = page.getByLabel('Choose a floor plan image to trace')
    await choose.setInputFiles({
      name: 'plan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    })
    const box = dialog(page, 'This image can’t be used')
    await expect(box).toContainText('For a PDF, export or screenshot the page')
    await box.getByRole('button', { name: 'OK' }).click()

    await choose.setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not a png'),
    })
    await expect(box).toContainText('couldn’t be read')
    await expect(box).toContainText('exporting it again as PNG or JPEG')
  })

  test('tracing from the 3D view says to switch to 2D', async ({ page }) => {
    await viewSwitch(page, '3D').click()
    await expect(page.locator('.view3d-canvas canvas')).toBeVisible()
    await page.getByLabel('Choose a floor plan image to trace').setInputFiles({
      name: 'plan.png',
      mimeType: 'image/png',
      buffer: planImage(),
    })
    await expect(dialog(page, 'This image can’t be used')).toContainText(
      'Switch to 2D',
    )
  })
})

test.describe('the 3D view without WebGL (D93)', () => {
  test('says WebGL is missing and goes back to the 2D view', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        id: string,
        ...rest: unknown[]
      ) {
        if (id === 'webgl' || id === 'webgl2' || id === 'experimental-webgl') {
          return null
        }
        return (real as (...a: unknown[]) => unknown).call(this, id, ...rest)
      } as typeof real
    })
    await openEditor(page)
    await viewSwitch(page, '3D').click()
    const failed = page.locator('.view3d-failed')
    await expect(failed).toContainText('needs WebGL')
    await expect(failed).toContainText('hardware acceleration')
    await expect(failed).toContainText('the 2D map')
    await expect(failed).toHaveAttribute('role', 'alert')
    await failed.getByRole('button', { name: 'Back to the 2D view' }).click()
    await expect(page.locator('.editor-canvas')).toBeVisible()
    await expect(page.locator('.view3d')).toHaveCount(0)
  })

  test('says so when the browser won’t make the graphics context', async ({
    page,
  }) => {
    // The first look for WebGL works; making the renderer then fails.
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        id: string,
        ...rest: unknown[]
      ) {
        // The check for WebGL passes no settings; the renderer does.
        if ((id === 'webgl' || id === 'webgl2') && rest.length > 0) {
          return null
        }
        return (real as (...a: unknown[]) => unknown).call(this, id, ...rest)
      } as typeof real
    })
    await openEditor(page)
    await viewSwitch(page, '3D').click()
    const failed = page.locator('.view3d-failed')
    await expect(failed).toContainText('couldn’t start')
    await expect(
      failed.getByRole('button', { name: 'Try again' }),
    ).toBeVisible()
    await failed.getByRole('button', { name: 'Back to the 2D view' }).click()
    await expect(page.locator('.editor-canvas')).toBeVisible()
  })

  test('says so when the 3D view’s code won’t load', async ({ page }) => {
    await openEditor(page)
    await page.route(/View3D.*\.(tsx|js)(\?.*)?$/, (route) => route.abort())
    await viewSwitch(page, '3D').click()
    const failed = page.locator('.view3d-failed')
    await expect(failed).toContainText('code couldn’t be loaded')
    await expect(
      failed.getByRole('button', { name: 'Reload the page' }),
    ).toBeVisible()
    await failed.getByRole('button', { name: 'Back to the 2D view' }).click()
    await expect(page.locator('.editor-canvas')).toBeVisible()
  })
})
