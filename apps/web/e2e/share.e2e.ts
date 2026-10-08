import { expect, test, type Page } from '@playwright/test'
import { openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

/** Moves the sample's router half a metre east, so the plan isn't the sample. */
async function moveRouter(page: Page) {
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Shift+ArrowRight')
}

async function routerPosition(page: Page) {
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  return panel(page).locator('dd').first()
}

async function copyLink(page: Page): Promise<string> {
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'Share link…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share link' })
  const field = dialog.getByRole('textbox', { name: 'Link to this plan' })
  await expect(field).toHaveValue(/#plan=1\./)
  const url = await field.inputValue()
  await dialog.getByRole('button', { name: 'Close' }).click()
  return url
}

test('a shared link opens the same plan in a fresh browser', async ({
  page,
  browser,
}) => {
  await openEditor(page)
  await moveRouter(page)
  const url = await copyLink(page)

  const other = await browser.newContext()
  const fresh = await other.newPage()
  await fresh.goto(url)
  await fresh.locator('.editor-canvas[data-scale]').waitFor()
  await expect(await routerPosition(fresh)).toHaveText('6.10 m, 1.20 m')
  // The plan leaves the address bar, so a reload doesn't open it again.
  expect(new URL(fresh.url()).hash).toBe('')
  await other.close()
})

test('a link pasted into an open tab opens its plan there', async ({
  page,
}) => {
  await openEditor(page)
  await moveRouter(page)
  const url = await copyLink(page)
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'Open the sample home' }).click()
  await expect(await routerPosition(page)).toHaveText('5.60 m, 1.20 m')

  await page.evaluate((hash) => {
    window.location.hash = hash
  }, new URL(url).hash)
  await expect(await routerPosition(page)).toHaveText('6.10 m, 1.20 m')
})

test('a damaged link explains itself and opens SignalPlan as usual', async ({
  page,
}) => {
  await page.goto('/#plan=1.not-a-real-plan')
  const dialog = page.getByRole('dialog', { name: 'This link can’t be opened' })
  await expect(dialog).toContainText('incomplete or damaged')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(await routerPosition(page)).toHaveText('5.60 m, 1.20 m')
})
