import { expect, test } from '@playwright/test'
import { openEditor } from './helpers.ts'

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
