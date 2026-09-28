import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const viewSwitch = (page: Page, label: '2D' | '3D') =>
  page.getByRole('group', { name: 'View' }).locator('label', { hasText: label })
const description = (page: Page) =>
  page.getByRole('list', { name: 'Floors in the 3D view' })

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('shows the floors in 3D, view only, with a text alternative (D57)', async ({
  page,
}) => {
  // A second floor with an access point, closed so it has floor area.
  await page
    .getByRole('navigation', { name: 'Floors' })
    .getByRole('button', { name: '+ Floor above' })
    .click()
  await page.keyboard.press('w')
  for (const [x, y] of [
    [0, 0],
    [15, 0],
    [15, 8],
    [0, 8],
    [0, 0],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')
  await page.keyboard.press('a')
  await clickPlan(page, 10, 4)
  await page.keyboard.press('v')

  await viewSwitch(page, '3D').click()
  await expect(page.locator('.view3d-canvas canvas')).toBeVisible()
  await expect(page.locator('.editor-canvas')).toHaveCount(0)
  // The upstairs access point reaches the main floor too (D51): 86% → 93%.
  await expect(description(page).getByRole('listitem')).toHaveText([
    /^Upper floor, at 2\.67 m: 4 walls, access point Access point 1\. 100% of 120 m²/,
    /^Main floor, at 0\.00 m: 22 walls, access point Wi-Fi 6E router\. 93% of 150 m²/,
  ])

  // View only: tools are off, and their shortcuts do nothing.
  const wall = page
    .getByRole('toolbar', { name: 'Tools' })
    .getByRole('button', { name: 'Wall' })
  await expect(wall).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('w')
  await expect(page.locator('.editor-canvas')).toHaveCount(0)

  // Floors can be hidden, spread and given full-height walls.
  await panel(page).getByLabel('Upper floor').uncheck()
  await expect(description(page).getByRole('listitem')).toHaveCount(1)
  await panel(page).getByLabel('Spread floors apart').fill('2')
  await expect(panel(page)).toContainText('2.00 m')
  await panel(page).getByLabel('Full-height walls').check()

  // The buttons move the camera, drawing each time.
  const host = page.locator('.view3d-canvas')
  const before = Number(await host.getAttribute('data-renders'))
  await page.getByRole('button', { name: 'Rotate left' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect
    .poll(async () => Number(await host.getAttribute('data-renders')))
    .toBeGreaterThanOrEqual(before + 2)

  // Back in 2D, editing works again.
  await viewSwitch(page, '2D').click()
  await expect(page.locator('.editor-canvas')).toBeVisible()
  await expect(wall).not.toHaveAttribute('aria-disabled')
})

test('draws smoothly while rotating (D57)', async ({ page }) => {
  await viewSwitch(page, '3D').click()
  const host = page.locator('.view3d-canvas')
  await expect(host.locator('canvas')).toBeVisible()
  await expect
    .poll(async () => Number(await host.getAttribute('data-renders')))
    .toBeGreaterThan(0)
  const box = (await host.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const count = async () => Number(await host.getAttribute('data-renders'))
  const first = await count()
  const times: number[] = []
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(
      box.x + box.width / 2 + i * 6,
      box.y + box.height / 2 + i,
    )
    times.push(Number(await host.getAttribute('data-render-ms')))
  }
  await page.mouse.up()
  // Every step of the drag drew a frame.
  expect((await count()) - first).toBeGreaterThanOrEqual(30)
  // The typical frame's drawing work stays well inside a 60 fps frame
  // (16.7 ms). The median, not the slowest: other tests share the CPU, and
  // the real frame rate is measured separately (D57).
  times.sort((a, b) => a - b)
  expect(times[15]).toBeLessThan(8)
})
