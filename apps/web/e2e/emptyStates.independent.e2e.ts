// Independent tests for D92, written from the requirement alone: "each empty
// state says what to do next, in a sentence, with the control to do it".
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickPlan, openEditor } from './helpers.ts'

const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Properties' })
const tool = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name })

// Stable phrases a user reads; partial so small copy edits don't break them.
const noWalls = /To start, pick/
const noAccessPoints = /No access points on this floor yet/
const noRadios = /Add an access point first/
const noNeighbours = /No neighbours’ networks yet/
const noSpots = /No survey spots yet/
const noOutline = /Close the outer walls/
const noCoverage = /Add an access point to see coverage/

async function newPlan(page: Page) {
  await page.getByText('File', { exact: true }).click()
  await page.getByRole('button', { name: 'New plan' }).click()
  await expect(
    panel(page).getByRole('heading', { name: 'Untitled plan' }),
  ).toBeVisible()
}

/** A new plan comes with one router; removing it leaves nothing at all. */
async function emptyPlan(page: Page) {
  await newPlan(page)
  await panel(page).getByRole('button', { name: 'Router', exact: true }).click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await expect(panel(page).getByText(noAccessPoints)).toBeVisible()
}

/** A sentence: starts with a capital, ends with a full stop. */
async function expectSentence(text: Locator) {
  await expect(text).toBeVisible()
  const words = (await text.innerText()).trim()
  expect(words).toMatch(/^[A-Z].*\.$/s)
  expect(words.split(/\s+/).length).toBeGreaterThanOrEqual(4)
}

/** Back to the Select tool with nothing selected: the plan panel. */
async function backToPlan(page: Page) {
  await page.keyboard.press('v')
  await page.keyboard.press('Escape')
  await expect(
    panel(page).getByRole('heading', { name: 'Untitled plan' }),
  ).toBeVisible()
}

async function drawBox(page: Page) {
  for (const [x, y] of [
    [2, 2],
    [8, 2],
    [8, 6],
    [2, 6],
    [2, 2],
  ] as const) {
    await clickPlan(page, x, y)
  }
  await page.keyboard.press('Escape')
}

test.beforeEach(async ({ page }) => {
  await openEditor(page)
})

test('an empty plan says what to do next in every empty section', async ({
  page,
}) => {
  await emptyPlan(page)
  const properties = panel(page)
  for (const phrase of [
    noWalls,
    noAccessPoints,
    noRadios,
    noNeighbours,
    noSpots,
  ]) {
    await expectSentence(properties.getByText(phrase))
  }
  // Coverage summary: a sentence, somewhere the user can see it.
  await expectSentence(page.getByText(noCoverage).first())

  // Each comes with a control right there.
  for (const name of [
    'Draw your first wall',
    'Place an access point',
    'Add a network',
    'Add survey spots',
  ]) {
    await expect(properties.getByRole('button', { name }).first()).toBeVisible()
    await expect(properties.getByRole('button', { name }).first()).toBeEnabled()
  }
})

test('a new plan with its router still says how to start and what coverage needs', async ({
  page,
}) => {
  await newPlan(page)
  await expectSentence(panel(page).getByText(noWalls))
  await expectSentence(page.getByText(noOutline).first())
  await expect(panel(page).getByText(noAccessPoints)).toHaveCount(0)
  await expect(panel(page).getByText(noRadios)).toHaveCount(0)
})

test('“Draw your first wall” picks the Wall tool and the canvas draws', async ({
  page,
}) => {
  await newPlan(page)
  await panel(page)
    .getByRole('button', { name: 'Draw your first wall' })
    .click()
  await expect(tool(page, 'Wall')).toHaveAttribute('aria-pressed', 'true')
  await drawBox(page)
  await backToPlan(page)
  await expect(
    panel(page).locator('dt', { hasText: 'Walls' }).locator('+ dd'),
  ).not.toHaveText('0')
  await expect(panel(page).getByText(noWalls)).toHaveCount(0)
  await expect(
    panel(page).getByRole('button', { name: 'Draw your first wall' }),
  ).toHaveCount(0)
  // With the outline closed, the coverage summary gives a number.
  await expect(page.getByText(noOutline)).toHaveCount(0)
  await expect(page.locator('.coverage-status').first()).toHaveText(
    /\d+% of \d+ m²/,
  )
})

test('every “Place an access point” picks the tool and a click places one', async ({
  page,
}) => {
  await emptyPlan(page)
  const buttons = panel(page).getByRole('button', {
    name: 'Place an access point',
  })
  const count = await buttons.count()
  expect(count).toBeGreaterThanOrEqual(1)
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('v')
    await expect(tool(page, 'Access point')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await buttons.nth(i).click()
    await expect(tool(page, 'Access point')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  await clickPlan(page, 4, 3)
  await backToPlan(page)
  await expect(
    panel(page).getByRole('button', { name: 'Access point 1', exact: true }),
  ).toBeVisible()
  await expect(panel(page).getByText(noAccessPoints)).toHaveCount(0)
  await expect(panel(page).getByText(noRadios)).toHaveCount(0)
  await expect(page.getByText(noCoverage)).toHaveCount(0)
  await expect(
    panel(page).getByRole('button', { name: 'Plan channels' }),
  ).toBeEnabled()
})

test('“Add a network” adds one and the neighbours’ message goes', async ({
  page,
}) => {
  await newPlan(page)
  // The other offered control, a scan, opens its dialog.
  await panel(page).getByRole('button', { name: 'Scan your network…' }).click()
  const scan = page.getByRole('dialog', { name: 'Scan your network' })
  await expect(scan).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(scan).toBeHidden()

  await panel(page).getByRole('button', { name: 'Add a network' }).click()
  await expect(
    panel(page).getByRole('button', { name: /^Remove Network 1/ }),
  ).toBeVisible()
  await expect(panel(page).getByText(noNeighbours)).toHaveCount(0)
})

test('“Add survey spots” picks the Survey tool and a click adds a spot', async ({
  page,
}) => {
  await newPlan(page)
  await panel(page).getByRole('button', { name: 'Add survey spots' }).click()
  await expect(tool(page, 'Survey')).toHaveAttribute('aria-pressed', 'true')
  // The Survey tool's own empty list says what to do: click the plan.
  await expectSentence(panel(page).getByText(/No spots yet/))
  await clickPlan(page, 4, 3)
  await expect(
    panel(page).getByRole('heading', { name: 'Spot 1' }),
  ).toBeVisible()
  await backToPlan(page)
  await expect(panel(page).getByText(noSpots)).toHaveCount(0)
  await page.keyboard.press('s')
  await expect(panel(page).getByText(/No spots yet/)).toHaveCount(0)
})

test('the sample home shows no empty messages for things it has', async ({
  page,
}) => {
  const properties = panel(page)
  await expect(
    properties.getByRole('heading', { name: 'Sample bungalow' }),
  ).toBeVisible()
  for (const phrase of [noWalls, noAccessPoints, noRadios]) {
    await expect(properties.getByText(phrase)).toHaveCount(0)
  }
  await expect(page.getByText(noOutline)).toHaveCount(0)
  await expect(page.getByText(noCoverage)).toHaveCount(0)
  for (const name of ['Draw your first wall', 'Place an access point']) {
    await expect(properties.getByRole('button', { name })).toHaveCount(0)
  }
  await expect(
    properties.getByRole('button', { name: 'Plan channels' }),
  ).toBeEnabled()
})

test('a surveyed home does not say it has no survey spots', async ({
  page,
}) => {
  const surveyed = readFileSync(
    fileURLToPath(
      new URL(
        '../../../packages/floorplan/fixtures/surveyed-home.json',
        import.meta.url,
      ),
    ),
  )
  await page.getByLabel('Open a plan file').setInputFiles({
    name: 'surveyed-home.json',
    mimeType: 'application/json',
    buffer: surveyed,
  })
  await expect(
    panel(page).getByRole('heading', { name: 'Surveyed bungalow' }),
  ).toBeVisible()
  await expect(panel(page).getByText(noSpots)).toHaveCount(0)
  await expect(panel(page).getByText(noWalls)).toHaveCount(0)
  await expect(panel(page).getByText(noAccessPoints)).toHaveCount(0)
})

test.describe('keyboard', () => {
  for (const key of ['Enter', 'Space'] as const) {
    test(`each control works with ${key}`, async ({ page }) => {
      await emptyPlan(page)
      const properties = panel(page)
      const checks: [string, () => Promise<void>][] = [
        [
          'Draw your first wall',
          () =>
            expect(tool(page, 'Wall')).toHaveAttribute('aria-pressed', 'true'),
        ],
        [
          'Place an access point',
          () =>
            expect(tool(page, 'Access point')).toHaveAttribute(
              'aria-pressed',
              'true',
            ),
        ],
        [
          'Add survey spots',
          () =>
            expect(tool(page, 'Survey')).toHaveAttribute(
              'aria-pressed',
              'true',
            ),
        ],
        [
          'Add a network',
          () =>
            expect(
              properties.getByRole('button', { name: /^Remove Network 1/ }),
            ).toBeVisible(),
        ],
      ]
      for (const [name, check] of checks) {
        await page.keyboard.press('Escape')
        await page.keyboard.press('v')
        await expect(tool(page, 'Select')).toHaveAttribute(
          'aria-pressed',
          'true',
        )
        // Reach the control by Tab from the plan name field, as a keyboard
        // user would, rather than focusing it directly.
        await properties.getByRole('textbox', { name: 'Plan name' }).focus()
        const target = properties.getByRole('button', { name }).first()
        let reached = false
        for (let i = 0; i < 40 && !reached; i++) {
          await page.keyboard.press('Tab')
          reached = await target.evaluate((el) => el === document.activeElement)
        }
        expect(reached, `Tab reaches “${name}”`).toBe(true)
        await page.keyboard.press(key)
        await check()
      }
    })
  }
})

test('axe finds no violations in the empty plan panel', async ({ page }) => {
  await emptyPlan(page)
  const { violations } = await new AxeBuilder({ page })
    .include('#properties')
    .analyze()
  expect(
    violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([])
})
