import { expect, test, type Page } from '@playwright/test'
import { clickPlan, openEditor, screenPoint } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const share = (page: Page) => panel(page).locator('.coverage-share')
const target = (page: Page) => panel(page).getByLabel('Coverage target')

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('shows the share of the sample home at the target, per band', async ({
  page,
}) => {
  // The sample home's walls enclose its stated 150 m².
  await expect(share(page)).toHaveText(
    '86% of 150 m² at Fair or better on 5 GHz.',
  )
  await page.getByText('6 GHz', { exact: true }).click()
  await expect(share(page)).toHaveText(
    '86% of 150 m² at Fair or better on 6 GHz.',
  )

  await target(page).selectOption('excellent')
  await expect(share(page)).toHaveText(
    '65% of 150 m² at Excellent or better on 6 GHz.',
  )
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    /Undo Change coverage target/,
  )
  await page.keyboard.press('ControlOrMeta+z')
  await expect(target(page)).toHaveValue('fair')

  await page.getByText('Imperial', { exact: true }).click()
  await expect(share(page)).toContainText('of 1,615 sq ft')
})

test('asks for a closed outline, then counts the room inside it', async ({
  page,
}) => {
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await expect(share(page)).toHaveText(
    'Close the outer walls to see how much of the floor is covered.',
  )

  await page.keyboard.press('w')
  for (const [x, y] of [
    [4, 2],
    [8, 2],
    [8, 5],
    [4, 5],
    [4, 2],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')
  await expect(share(page)).toHaveText(
    /^\d+% of 12 m² at Fair or better on 5 GHz\.$/,
  )
})

test('shows no share while nothing broadcasts on the band', async ({
  page,
}) => {
  await panel(page).getByRole('button', { name: 'Router' }).click()
  await page.keyboard.press('Delete')
  await expect(share(page)).toBeHidden()
})

test('says how to turn on a band that nothing broadcasts on', async ({
  page,
}) => {
  // A New plan's router is dual-band (D20), so 6 GHz starts empty.
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await page.getByText('6 GHz', { exact: true }).click()
  const notice = page.locator('.notice')
  await expect(notice).toHaveText(
    'No access point on this floor broadcasts on this band. Select one and turn the band on under Bands.',
  )

  await panel(page).getByRole('button', { name: 'Router' }).click()
  await panel(page)
    .getByRole('group', { name: 'Bands' })
    .getByRole('checkbox', { name: '6 GHz' })
    .check()
  await expect(notice).toBeHidden()
})

test('keeps the summary in view in the status bar on a laptop (D37)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const summary = page.locator('.status-bar .coverage-status')
  await expect(summary).toHaveText('86% of 150 m² at Fair or better on 5 GHz.')
  await expect(summary).toBeInViewport({ ratio: 1 })

  // Selecting the router fills the panel; the summary stays in view.
  await panel(page).getByRole('button', { name: 'Router' }).click()
  await expect(summary).toBeInViewport({ ratio: 1 })

  // With nothing broadcasting, the status bar shows no summary.
  await page.keyboard.press('Delete')
  await expect(summary).toBeHidden()
})

test('announces the summary once a drag ends, not during it', async ({
  page,
}) => {
  const summary = page.locator('.status-bar .coverage-status')
  const status = page.locator('.coverage-announcement')
  const before = '86% of 150 m² at Fair or better on 5 GHz.'
  await expect(status).toHaveText(before)

  // Drag the router into a far corner; the visible summary follows it,
  // but the live region holds the settled text until release.
  const router = await screenPoint(page, 5.6, 1.2)
  const to = await screenPoint(page, 0.5, 0.5)
  await page.mouse.move(router.x, router.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(summary).not.toHaveText(before)
  await expect(status).toHaveText(before)
  await page.mouse.up()
  await expect(status).toHaveText((await summary.textContent())!)
  await expect(status).not.toHaveText(before)
})
