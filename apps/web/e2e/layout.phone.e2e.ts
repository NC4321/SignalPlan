import { expect, test } from '@playwright/test'
import { openEditor, planImage } from './helpers.ts'

test('opens properties as a drawer on a phone', async ({ page }) => {
  await page.goto('/')
  const details = page.getByRole('button', { name: 'Details' })
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.getByRole('complementary', { name: 'Properties' }),
  ).toBeInViewport()
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  )
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test('fits the calibration bar and status bar on a phone', async ({ page }) => {
  await openEditor(page)
  await page.getByLabel('Choose a floor plan image to trace').setInputFiles({
    name: 'plan.png',
    mimeType: 'image/png',
    buffer: planImage(),
  })
  const canvas = (await page.locator('.editor-canvas').boundingBox())!
  const x = canvas.x + canvas.width / 2
  const y = canvas.y + canvas.height / 3
  await page.mouse.click(x - 60, y)
  await page.mouse.click(x + 60, y)
  // A long readout must not widen the layout either.
  await page.mouse.move(x + 20, y + 20)
  const input = page.getByLabel('Real distance between the two points')
  await expect(input).toBeVisible()
  const width = page.viewportSize()!.width
  for (const selector of ['.app', '.calibration-bar', '.status-bar']) {
    const box = (await page.locator(selector).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  }
  const field = (await input.boundingBox())!
  expect(field.x + field.width).toBeLessThanOrEqual(width)
})
