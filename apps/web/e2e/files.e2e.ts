import { expect, test, type Page } from '@playwright/test'
import { openEditor, screenPoint, summaryCount } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })

async function openFileMenu(page: Page) {
  await page.getByText('File', { exact: true }).click()
}

async function moveRouter(page: Page) {
  await panel(page).getByRole('button', { name: 'Wi-Fi 6E router' }).click()
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
  await panel(page).getByRole('button', { name: 'Wi-Fi 6E router' }).click()
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
    panel(page).getByRole('button', { name: 'Router' }),
  ).toBeVisible()
  // With no walls yet, there is still coverage around the router.
  const near = await screenPoint(page, 7, 4)
  await page.mouse.move(near.x, near.y)
  await expect(page.locator('.readout')).toContainText(/dBm/)
})

test('asks before replacing an edited plan', async ({ page }) => {
  await openEditor(page)
  await moveRouter(page)
  await openFileMenu(page)
  await page.getByRole('button', { name: 'New plan' }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Replace your current plan?',
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await page.keyboard.press('Escape') // clear the router selection
  expect(await summaryCount(page, 'Walls')).toBeGreaterThan(0)

  await openFileMenu(page)
  await page.getByRole('button', { name: 'New plan' }).click()
  await dialog.getByRole('button', { name: 'Start a new plan' }).click()
  expect(await summaryCount(page, 'Walls')).toBe(0)
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
  await page.locator('input[type=file]').setInputFiles({
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
  await page.locator('input[type=file]').setInputFiles({
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
