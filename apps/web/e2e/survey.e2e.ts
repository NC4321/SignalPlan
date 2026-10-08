import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' })
const spotHeading = (page: Page) =>
  panel(page).getByRole('heading', { name: 'Spot 1' })

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

/** Drags from one plan point to another, in metres. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenPoint(page, ...from)
  const b = await screenPoint(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await page.mouse.up()
}

test('adds, edits, moves and deletes a survey spot, with undo (D71)', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await expect(
    page
      .getByRole('toolbar', { name: 'Tools' })
      .getByRole('button', { name: 'Survey' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    panel(page).getByRole('heading', { name: 'Survey tool' }),
  ).toBeVisible()
  await expect(panel(page)).toContainText('No spots yet on any floor.')
  await expect(panel(page)).toContainText('AirPort Utility')

  // A click adds a spot and selects it.
  await clickPlan(page, 3, 4)
  await expect(spotHeading(page)).toBeVisible()
  await expect(panel(page).locator('dd').first()).toHaveText('3.00 m, 4.00 m')
  await expect(undo(page)).toHaveAttribute('title', /Add survey spot/)

  // A reading from the router, moved to 5 GHz, at −58 dBm.
  await panel(page).getByRole('button', { name: 'Add a reading' }).click()
  await panel(page).getByRole('combobox', { name: /Band/ }).selectOption('5GHz')
  const signal = panel(page).getByRole('textbox', { name: /Signal \(dBm\)/ })
  await signal.fill('−58')
  await signal.press('Enter')
  await expect(signal).toHaveValue('-58')
  await expect(
    panel(page).getByRole('group', { name: 'Router, 5 GHz' }),
  ).toBeVisible()
  await expect(undo(page)).toHaveAttribute(
    'title',
    /Change a reading at Spot 1/,
  )
  const note = panel(page).getByRole('textbox', { name: 'Note' })
  await note.fill('Kitchen')
  await note.press('Enter')

  // Dragging the pin moves the spot as one undo step.
  await drag(page, [3, 4], [6, 4])
  await expect(panel(page).locator('dd').first()).toHaveText('6.00 m, 4.00 m')
  await expect(undo(page)).toHaveAttribute('title', /Move survey spot/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(panel(page).locator('dd').first()).toHaveText('3.00 m, 4.00 m')

  // Delete removes it; undo brings it back with its reading.
  await page.keyboard.press('Delete')
  await expect(spotHeading(page)).toHaveCount(0)
  await expect(panel(page)).toContainText('No spots yet on any floor.')
  await page.keyboard.press('ControlOrMeta+z')
  const listed = panel(page).getByRole('button', {
    name: 'Spot 1: 1 reading (Kitchen)',
  })
  await expect(listed).toBeVisible()

  // The plan panel lists spots too; picking one selects it.
  await page.keyboard.press('v')
  await listed.click()
  await expect(spotHeading(page)).toBeVisible()
  await expect(signal).toHaveValue('-58')
})

test('deleting an access point deletes its readings; undo brings both back (D71)', async ({
  page,
}) => {
  await page.keyboard.press('s')
  await clickPlan(page, 3, 4)
  await panel(page).getByRole('button', { name: 'Add a reading' }).click()
  await expect(
    panel(page).getByRole('group', { name: 'Router, 2.4 GHz' }),
  ).toBeVisible()

  // Select the router (its pin is at 5.6, 1.2) and delete it.
  await page.keyboard.press('v')
  await clickPlan(page, 5.6, 1.2)
  await expect(
    panel(page).getByRole('heading', { name: 'Router' }),
  ).toBeVisible()
  await page.keyboard.press('Delete')
  await expect(
    panel(page).getByRole('button', { name: 'Spot 1: no readings' }),
  ).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(
    panel(page).getByRole('button', { name: 'Spot 1: 1 reading' }),
  ).toBeVisible()
})

test('a radio takes BSSIDs in any common form, one radio each (D71)', async ({
  page,
}) => {
  await clickPlan(page, 5.6, 1.2)
  const five = panel(page).getByRole('textbox', { name: '5 GHz BSSIDs' })
  await five.fill('A4-2B-B0-12-34-56, a42bb0123457, oops')
  await five.press('Enter')
  await expect(panel(page).getByRole('alert')).toContainText(
    'oops isn’t a BSSID',
  )
  await five.fill('A4-2B-B0-12-34-56, a42bb0123457')
  await five.press('Enter')
  await expect(five).toHaveValue('a4:2b:b0:12:34:56, a4:2b:b0:12:34:57')
  await expect(undo(page)).toHaveAttribute('title', /Change 5 GHz BSSIDs/)

  const six = panel(page).getByRole('textbox', { name: '6 GHz BSSIDs' })
  await six.fill('a4:2b:b0:12:34:57')
  await six.press('Enter')
  await expect(panel(page).getByRole('alert')).toContainText(
    'already on Router, 5 GHz',
  )
})
