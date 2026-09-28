import { expect, test, type Page } from '@playwright/test'
import { openEditor, screenPoint, summaryCount } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

async function openFileMenu(page: Page) {
  await page.getByText('File', { exact: true }).click()
}

async function moveRouter(page: Page) {
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved' }),
  ).toHaveText('Saved in this browser')
}

test('restores the last plan after a reload', async ({ page }) => {
  await openEditor(page)
  await moveRouter(page)
  await page.reload()
  await openEditor(page)
  await panel(page)
    .getByRole('button', { name: 'Wi-Fi 6E router', exact: true })
    .click()
  await expect(panel(page).locator('dd').first()).toHaveText('6.10 m, 1.20 m')
})

test('remembers the display units', async ({ page }) => {
  await openEditor(page)
  await page.getByText('Imperial', { exact: true }).click()
  await page.reload()
  await openEditor(page)
  await expect(page.getByRole('radio', { name: 'Imperial' })).toBeChecked()
})

test('starts a new plan straight away from the untouched sample', async ({
  page,
}) => {
  await openEditor(page)
  await openFileMenu(page)
  await page.getByRole('button', { name: 'New plan' }).click()
  await expect(
    panel(page).getByRole('heading', { level: 2 }).first(),
  ).toHaveText('Untitled plan')
  expect(await summaryCount(page, 'Walls')).toBe(0)
  await expect(
    panel(page).getByRole('button', { name: 'Router', exact: true }),
  ).toBeVisible()
  // With no walls yet, there is still coverage around the router.
  const near = await screenPoint(page, 7, 4)
  await page.mouse.move(near.x, near.y)
  await expect(page.locator('.readout')).toContainText(/dBm/)
})

test('keeps an edited plan in My plans when starting a new one', async ({
  page,
}) => {
  await openEditor(page)
  await moveRouter(page)
  await openFileMenu(page)
  await page.getByRole('button', { name: 'New plan' }).click()
  // No confirmation: the edited sample is kept in the list.
  expect(await summaryCount(page, 'Walls')).toBe(0)

  await openFileMenu(page)
  await page.getByRole('button', { name: 'My plans…' }).click()
  const dialog = page.getByRole('dialog', { name: 'My plans' })
  await expect(dialog.getByText('Sample bungalow')).toBeVisible()
  await dialog.getByRole('button', { name: 'Open Sample bungalow' }).click()
  await expect(dialog).toBeHidden()
  expect(await summaryCount(page, 'Walls')).toBeGreaterThan(0)
})

test('renames, duplicates and deletes plans', async ({ page }) => {
  await openEditor(page)
  await moveRouter(page)
  await openFileMenu(page)
  await page.getByRole('button', { name: 'My plans…' }).click()
  const dialog = page.getByRole('dialog', { name: 'My plans' })

  await dialog.getByRole('button', { name: 'Rename Sample bungalow' }).click()
  const field = dialog.getByRole('textbox', { name: /New name/ })
  await field.fill('Our house')
  await field.press('Enter')
  await expect(dialog.getByText('Our house', { exact: true })).toBeVisible()
  // The open plan was renamed too, as an undoable edit.
  await expect(page.locator('.plan-name')).toHaveText('Our house')

  await dialog.getByRole('button', { name: 'Duplicate Our house' }).click()
  await expect(dialog.getByText('Copy of Our house')).toBeVisible()

  await dialog.getByRole('button', { name: 'Delete Copy of Our house' }).click()
  const confirm = page.getByRole('dialog', {
    name: 'Delete “Copy of Our house”?',
  })
  await expect(confirm).toContainText('can’t be undone')
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(dialog.getByText('Copy of Our house')).toBeHidden()
  await expect(dialog.getByText('Our house', { exact: true })).toBeVisible()
})

test('moves a plan saved by the previous version into My plans', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem(
      'signalplan:plan',
      JSON.stringify({
        schemaVersion: 1,
        name: 'Old flat',
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
      }),
    )
  })
  await openEditor(page)
  await expect(page.locator('.plan-name')).toHaveText('Old flat')
  expect(
    await page.evaluate(() => localStorage.getItem('signalplan:plan')),
  ).toBeNull()
})

test('saves a plan to a file named after it', async ({ page }) => {
  await openEditor(page)
  const name = panel(page).getByLabel('Plan name')
  await name.fill('My house')
  await name.press('Enter')
  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const file = await download
  expect(file.suggestedFilename()).toBe('My house.signalplan.json')
  const text = await (await file.createReadStream()).toArray()
  const plan = JSON.parse(Buffer.concat(text).toString('utf8'))
  expect(plan).toMatchObject({ schemaVersion: 1, name: 'My house' })
})

test('opens a plan file', async ({ page }) => {
  await openEditor(page)
  const plan = {
    schemaVersion: 1,
    name: 'Studio',
    floors: [
      {
        id: 'f',
        name: 'Floor',
        elevationM: 0,
        heightM: 2.5,
        nodes: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 5, y: 0 },
        ],
        walls: [{ id: 'w', from: 'a', to: 'b', material: 'brick' }],
        openings: [],
      },
    ],
    accessPoints: [],
  }
  await page.getByLabel('Open a plan file').setInputFiles({
    name: 'studio.signalplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan)),
  })
  await expect(
    panel(page).getByRole('heading', { level: 2 }).first(),
  ).toHaveText('Studio')
  expect(await summaryCount(page, 'Walls')).toBe(1)
})

test('explains why a file can’t be opened', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('Open a plan file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion": 1, "name": "x", "floors": []}'),
  })
  const dialog = page.getByRole('dialog', { name: 'This file can’t be opened' })
  await expect(dialog).toContainText('broken.json')
  await expect(dialog).toContainText('floors')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(dialog).toBeHidden()
})

test('offers to rescue a saved plan that no longer opens', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('signalplan:plan', '{"schemaVersion": 99}')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/')
  const dialog = page.getByRole('dialog', {
    name: 'Your saved plan couldn’t be opened',
  })
  await expect(dialog).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download it' }).click()
  expect((await download).suggestedFilename()).toBe(
    'unreadable-plan.signalplan.json',
  )
  await dialog.getByRole('button', { name: 'Continue with the sample' }).click()
  await expect(
    panel(page).getByRole('heading', { level: 2 }).first(),
  ).toHaveText('Sample bungalow')
})
