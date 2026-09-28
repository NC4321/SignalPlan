import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const share = (page: Page) => panel(page).locator('.coverage-share')
const floors = (page: Page) => page.getByRole('navigation', { name: 'Floors' })
const floorButton = (page: Page, name: string) =>
  floors(page).getByRole('listitem').getByRole('button', { name })
const floorSection = (page: Page) =>
  panel(page).getByRole('region', { name: 'Floor' })

/** The floor names in the stack, top first. */
const stack = (page: Page) => floors(page).getByRole('listitem').allInnerTexts()

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('adds a floor above, shows it, and switches back (D52)', async ({
  page,
}) => {
  await expect(stack(page)).resolves.toEqual(['Main floor'])
  await floors(page).getByRole('button', { name: '+ Floor above' }).click()
  await expect.poll(() => stack(page)).toEqual(['Upper floor', 'Main floor'])
  await expect(floorButton(page, 'Upper floor')).toHaveAttribute(
    'aria-current',
    'true',
  )
  // The router downstairs still reaches the empty floor.
  await expect(page.locator('.notice')).toHaveText(
    'No access points on this floor. The heatmap shows signal from other floors.',
  )
  await expect(share(page)).toHaveText(
    'Upper floor: Close the outer walls to see how much of the floor is covered.',
  )

  await floorButton(page, 'Main floor').click()
  await expect(share(page)).toHaveText(
    'Main floor: 86% of 150 m² at Fair or better on 5 GHz.',
  )

  // PageUp and PageDown move through the stack.
  await page.keyboard.press('PageUp')
  await expect(floorButton(page, 'Upper floor')).toHaveAttribute(
    'aria-current',
    'true',
  )
  await page.keyboard.press('PageDown')
  await expect(floorButton(page, 'Main floor')).toHaveAttribute(
    'aria-current',
    'true',
  )

  // Adding the floor is one undo step.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => stack(page)).toEqual(['Main floor'])
  await expect(share(page)).toHaveText(
    '86% of 150 m² at Fair or better on 5 GHz.',
  )
})

test('an access point upstairs raises coverage downstairs', async ({
  page,
}) => {
  await floors(page).getByRole('button', { name: '+ Floor above' }).click()
  await page.keyboard.press('a')
  await clickPlan(page, 13, 8)
  await expect(page.locator('.notice')).toHaveCount(0)
  await floorButton(page, 'Main floor').click()
  await expect(share(page)).toHaveText(/^Main floor: \d+% of 150 m²/)
  const text = (await share(page).textContent())!
  expect(Number(/(\d+)%/.exec(text)![1])).toBeGreaterThan(86)
})

test('edits the floor on show: name, elevation, construction, delete', async ({
  page,
}) => {
  await floors(page).getByRole('button', { name: '+ Floor below' }).click()
  await expect.poll(() => stack(page)).toEqual(['Main floor', 'Basement'])
  const section = floorSection(page)
  await expect(section.getByLabel('Elevation')).toHaveValue('-2.67 m')

  await section.getByLabel('Floor name').fill('Cellar')
  await section.getByLabel('Floor name').press('Enter')
  await expect.poll(() => stack(page)).toEqual(['Main floor', 'Cellar'])

  // Raising it above the main floor moves it up the stack.
  await section.getByLabel('Elevation').fill('3')
  await section.getByLabel('Elevation').press('Enter')
  await expect.poll(() => stack(page)).toEqual(['Cellar', 'Main floor'])
  await section.getByLabel('Elevation').fill('-3')
  await section.getByLabel('Elevation').press('Enter')
  await expect.poll(() => stack(page)).toEqual(['Main floor', 'Cellar'])
  await expect(section).toContainText('Nothing is below Cellar')

  // Move up swaps it with the main floor.
  await section.getByRole('button', { name: 'Move up' }).click()
  await expect.poll(() => stack(page)).toEqual(['Cellar', 'Main floor'])
  await expect(section.getByRole('button', { name: 'Move up' })).toBeDisabled()

  await section.getByLabel('Floor construction').selectOption('concrete-slab')
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Undo Change Cellar construction/,
  )

  await section.getByRole('button', { name: 'Delete floor' }).click()
  await expect.poll(() => stack(page)).toEqual(['Main floor'])
  await expect(page.locator('.status-bar')).toContainText(
    'Deleted Cellar and everything on it. Undo brings it back.',
  )
  await expect(
    floorSection(page).getByRole('button', { name: 'Delete floor' }),
  ).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => stack(page)).toEqual(['Cellar', 'Main floor'])
})
