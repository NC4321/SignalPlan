import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const tools = (page: Page) => page.getByRole('toolbar', { name: 'Tools' })
const heading = (page: Page, name: string) =>
  panel(page).getByRole('heading', { name, exact: true })
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' })

/** Adds an access point in the empty middle of the living room. */
async function place(page: Page) {
  await page.keyboard.press('a')
  await clickPlan(page, 3, 2)
  await expect(heading(page, 'Access point 1')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('picks the tool with A or the toolbar, and Esc returns to Select', async ({
  page,
}) => {
  const button = tools(page).getByRole('button', { name: 'Access point' })
  await page.keyboard.press('a')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(heading(page, 'Access point tool')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    tools(page).getByRole('button', { name: 'Select' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
})

test('places an access point, selected, and undoes and redoes it', async ({
  page,
}) => {
  await place(page)
  await expect(panel(page).getByLabel('Name')).toHaveValue('Access point 1')
  await expect(panel(page).getByLabel('Mounted at')).toHaveValue('1.00 m')
  const bands = panel(page).getByRole('group', { name: 'Bands' })
  for (const band of ['2.4 GHz', '5 GHz', '6 GHz']) {
    await expect(bands.getByRole('checkbox', { name: band })).toBeChecked()
  }
  // The heatmap still reads out a signal.
  const canvas = page.locator('.editor-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.readout')).toContainText(/-\d+ dBm/)

  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Add access point/,
  )
  await page.keyboard.press('ControlOrMeta+z')
  await expect(heading(page, 'Access point 1')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await page.keyboard.press('Escape')
  await expect(
    panel(page).getByRole('button', { name: 'Access point 1' }),
  ).toBeVisible()
})

test('grabs an existing access point instead of stacking a new one', async ({
  page,
}) => {
  await page.keyboard.press('a')
  const router = await screenPoint(page, 5.6, 1.2)

  // A click on the router selects it; nothing is added.
  await page.mouse.click(router.x, router.y)
  await expect(heading(page, 'Router')).toBeVisible()
  await expect(undoButton(page)).toBeDisabled()

  // A drag moves it, and the tool stays active.
  const to = await screenPoint(page, 7.6, 2.2)
  await page.mouse.move(router.x, router.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await expect(undoButton(page)).toHaveAttribute('title', /Undo Move Router/)
  await expect(panel(page).locator('dd').first()).not.toHaveText(
    '5.60 m, 1.20 m',
  )
  await expect(
    tools(page).getByRole('button', { name: 'Access point' }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Clicking empty floor still adds one, and there are now two in all.
  await clickPlan(page, 3, 2)
  await expect(heading(page, 'Access point 1')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(panel(page).locator('.object-list li')).toHaveCount(2)
})

test('renames an access point and changes its height', async ({ page }) => {
  await place(page)
  const name = panel(page).getByLabel('Name')
  await name.fill('Office mesh')
  await name.press('Enter')
  await expect(heading(page, 'Office mesh')).toBeVisible()

  const height = panel(page).getByLabel('Mounted at')
  // The sample's ceiling is 2.4 m, so 3 m is refused.
  await height.fill('3')
  await height.press('Enter')
  await expect(height).toHaveAttribute('aria-invalid', 'true')
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await height.fill('2')
  await height.press('Enter')
  await expect(height).toHaveValue('2.00 m')
  await expect(height).toHaveAttribute('aria-invalid', 'false')
})

test('turns bands off and on, keeping at least one', async ({ page }) => {
  await place(page)
  const bands = panel(page).getByRole('group', { name: 'Bands' })
  const box = (band: string) => bands.getByRole('checkbox', { name: band })

  await box('6 GHz').uncheck()
  await expect(box('6 GHz')).not.toBeChecked()
  await expect(panel(page).getByLabel('6 GHz power (dBm EIRP)')).toBeHidden()
  await box('5 GHz').uncheck()
  await expect(box('2.4 GHz')).toBeDisabled()
  await box('6 GHz').check()
  await expect(box('2.4 GHz')).toBeEnabled()
  await expect(panel(page).getByLabel('6 GHz power (dBm EIRP)')).toBeVisible()
})

test('sets power, noting values above the FCC limit', async ({ page }) => {
  await place(page)
  const power = panel(page).getByLabel('2.4 GHz power (dBm EIRP)')
  const note = panel(page).getByText('Above the legal limit')
  await expect(power).toHaveValue('')
  await expect(power).toHaveAttribute('placeholder', '20 (typical)')

  await power.fill('30')
  await power.press('Enter')
  await expect(power).toHaveValue('30')
  await expect(note).toBeHidden()

  await power.fill('40')
  await power.press('Enter')
  await expect(power).toHaveValue('40')
  await expect(note).toBeVisible()

  await power.fill('50')
  await power.press('Enter')
  await expect(power).toHaveAttribute('aria-invalid', 'true')
  await expect(panel(page).getByRole('alert')).toContainText('-10 to 40')
  await power.press('Escape')
  await expect(power).toHaveValue('40')

  await power.fill('')
  await power.press('Enter')
  await expect(power).toHaveValue('')
  await expect(note).toBeHidden()
})

test('deletes access points with the Delete key or the panel', async ({
  page,
}) => {
  await place(page)
  await page.keyboard.press('Delete')
  await expect(heading(page, 'Access point 1')).toBeHidden()
  await expect(undoButton(page)).toHaveAttribute(
    'title',
    /Undo Delete access point/,
  )
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('Escape')
  await panel(page).getByRole('button', { name: 'Access point 1' }).click()
  await panel(page).getByRole('button', { name: 'Delete' }).click()
  await expect(
    panel(page).getByRole('button', { name: 'Access point 1' }),
  ).toBeHidden()
})

test('explains an empty floor after deleting the last access point', async ({
  page,
}) => {
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Delete' }).click()
  const notice = page.getByText(
    'No access points on this floor. Add one with the Access point tool.',
  )
  await expect(notice).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(notice).toBeHidden()
  await expect(
    panel(page).getByRole('button', { name: 'Router', exact: true }),
  ).toBeVisible()
})

test('a locked access point stays put when dragged or nudged (D43)', async ({
  page,
}) => {
  const router = await screenPoint(page, 5.6, 1.2)
  const position = panel(page).locator('dd').first()
  const notice = page.locator('.status-notice')
  await page.mouse.click(router.x, router.y)
  await expect(heading(page, 'Router')).toBeVisible()

  const locked = panel(page).getByRole('checkbox', { name: /Locked/ })
  await locked.check()
  await expect(undoButton(page)).toHaveAttribute('title', /Undo Lock Router/)
  await expect(panel(page)).toContainText('Locked, so it can’t be moved')

  // A drag selects it but doesn't move it, and says why.
  const to = await screenPoint(page, 7.6, 2.2)
  await page.mouse.move(router.x, router.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(notice).toHaveText('Locked: unlock it in the panel to move it')
  await page.mouse.up()
  await expect(position).toHaveText('5.60 m, 1.20 m')
  await expect(undoButton(page)).toHaveAttribute('title', /Undo Lock/)

  // So do the arrow keys.
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('ArrowRight')
  await expect(position).toHaveText('5.60 m, 1.20 m')

  // Unlocked, it drags again; the notice goes with the edit.
  await locked.uncheck()
  await expect(notice).toBeHidden()
  await page.mouse.move(router.x, router.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await expect(position).not.toHaveText('5.60 m, 1.20 m')
  await expect(undoButton(page)).toHaveAttribute('title', /Undo Move Router/)
})

test('a locked access point can still be deleted (D43)', async ({ page }) => {
  const router = await screenPoint(page, 5.6, 1.2)
  await page.mouse.click(router.x, router.y)
  await panel(page)
    .getByRole('checkbox', { name: /Locked/ })
    .check()
  await page.locator('.editor-canvas').focus()
  await page.keyboard.press('Delete')
  await expect(heading(page, 'Router')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+z')
  await page.mouse.click(router.x, router.y)
  await expect(
    panel(page).getByRole('checkbox', { name: /Locked/ }),
  ).toBeChecked()
})
