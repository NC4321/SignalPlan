import { expect, test } from '@playwright/test'

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
