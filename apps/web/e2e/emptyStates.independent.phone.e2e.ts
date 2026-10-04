// Independent phone check for D92: the empty-state controls are visible and
// usable at phone size.
import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const tool = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name })

test('the first-wall control works from the Details drawer on a phone', async ({
  page,
}) => {
  await openEditor(page)
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await page.getByRole('button', { name: 'Details' }).click()

  const properties = panel(page)
  await expect(properties.getByText(/No walls on this floor yet/)).toBeVisible()
  const draw = properties.getByRole('button', { name: 'Draw your first wall' })
  await draw.scrollIntoViewIfNeeded()
  await expect(draw).toBeInViewport({ ratio: 1 })
  const box = (await draw.boundingBox())!
  // Big enough to tap, and inside the screen.
  expect(box.height).toBeGreaterThanOrEqual(24)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)

  await draw.tap()
  await expect(tool(page, 'Wall')).toHaveAttribute('aria-pressed', 'true')
  // The drawer must not cover the plan once a drawing tool is picked,
  // or the user can't draw. Close it if the app left it open.
  const details = page.getByRole('button', { name: 'Details' })
  if ((await details.getAttribute('aria-expanded')) === 'true') {
    await details.click()
  }
  for (const [x, y] of [
    [1, 1],
    [4, 1],
    [4, 3],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await page.keyboard.press('Escape')
  await details.click()
  await expect(
    properties.getByRole('heading', { name: 'Untitled plan' }),
  ).toBeVisible()
  await expect(
    properties.locator('dt', { hasText: 'Walls' }).locator('+ dd'),
  ).not.toHaveText('0')
  await expect(properties.getByText(/No walls on this floor yet/)).toHaveCount(
    0,
  )
})
