import { expect, test } from '@playwright/test'
import { openEditor, summaryCount } from './helpers.ts'

test('? opens the shortcuts, Esc closes them and focus returns', async ({
  page,
}) => {
  await openEditor(page)
  const canvas = page.locator('.editor-canvas')
  await canvas.focus()
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Tools' })).toBeVisible()
  await expect(dialog.getByText('Draw walls')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(canvas).toBeFocused()
  // Esc closed the dialog without also reaching the editor.
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('the top bar’s ? button opens them too', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
})

test('typing ? in a text field types it', async ({ page }) => {
  await openEditor(page)
  const name = page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('textbox')
    .first()
  await name.fill('')
  await name.press('?')
  await expect(name).toHaveValue('?')
  await expect(
    page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
  ).toBeHidden()
})

test('keys in an open dialog leave the plan behind it alone', async ({
  page,
}) => {
  await openEditor(page)
  const walls = await summaryCount(page, 'Walls')
  const canvas = page.locator('.editor-canvas')
  await canvas.focus()
  await page.keyboard.press('Tab')
  const panel = page.getByRole('complementary', { name: 'Properties' })
  await expect(
    panel.getByRole('heading', { name: 'Wall', exact: true }),
  ).toBeVisible()

  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  for (const key of ['Delete', 'Backspace', 'w', 'Control+Z', 'PageUp']) {
    await page.keyboard.press(key)
  }
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // The wall is still selected, the tool unchanged and nothing to undo.
  await expect(
    panel.getByRole('heading', { name: 'Wall', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await page.keyboard.press('Escape')
  expect(await summaryCount(page, 'Walls')).toBe(walls)
})

test('Esc in a dialog closes it and leaves the tool as it was', async ({
  page,
}) => {
  await openEditor(page)
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('w')
  const wallTool = page.getByRole('button', { name: 'Wall', exact: true })
  await expect(wallTool).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(wallTool).toHaveAttribute('aria-pressed', 'true')

  // With the dialog closed, Esc reaches the editor again.
  await page.keyboard.press('Escape')
  await expect(wallTool).toHaveAttribute('aria-pressed', 'false')
})
