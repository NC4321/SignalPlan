import { parsePlan, type Band, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { evaluateCoverage } from './coverage.ts'
import { bigHouse, roomGrid } from './testPlans.ts'

/**
 * Speed of the coverage grid against the Phase 2 budget: a 100 m² floor at
 * 10 cm cells in under 200 ms (OUTLINE.md, D11). Run with `pnpm speed`, one
 * file at a time so other tests don't compete for the CPU.
 *
 * The budget is for a Web Worker on a laptop, but this check runs on CI.
 * GitHub's ubuntu-latest runners measured about 2.1× slower than a desktop
 * i5-12600K (sample home 40 vs 18 ms, room grid 170 vs 80 ms), and runner
 * hardware varies. The room grid, far busier than a real 100 m² home, lands
 * at ~170 ms there: within budget, but too close for a check that must not
 * flake. So CI fails at 1.5× the budget. That still catches the room grid
 * getting ~1.8× slower, or the sample home ~7× slower, while normal runner
 * variation passes. The budget itself is printed with every result.
 */
// Both exist in Node and in Web Workers; the engine's lib has no DOM or Node types.
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 200
/**
 * Large homes are held to the budget on a device 4× slower than the desktop
 * (Lighthouse's mobile slowdown), so 50 ms here (D29).
 */
const LARGE_HOME_BUDGET_MS = BUDGET_MS / 4
/** CI runners are slower and vary, so CI fails at 1.5× a budget (D26). */
const CI_MARGIN = 1.5
const WARM_UP_RUNS = 5
const RUNS = 30

function measure(plan: Plan, floorId: string, band: Band) {
  for (let i = 0; i < WARM_UP_RUNS; i++) evaluateCoverage(plan, floorId, band)
  const times: number[] = []
  let cells = 0
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    const coverage = evaluateCoverage(plan, floorId, band)
    times.push(performance.now() - started)
    cells = coverage.grid.cols * coverage.grid.rows
  }
  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.min(RUNS - 1, Math.floor(q * RUNS))]!
  return { median: at(0.5), p95: at(0.95), areaM2: cells * 0.01 }
}

function report(
  name: string,
  band: Band,
  budget: number,
  r: ReturnType<typeof measure>,
) {
  console.log(
    `${name}, ${band}: median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms over ${RUNS} runs (${r.areaM2.toFixed(0)} m² grid, budget ${budget} ms, CI limit ${budget * CI_MARGIN} ms)`,
  )
}

describe('coverage grid speed at 10 cm cells', () => {
  const sample = parsePlan(sampleHome)
  if (!sample.ok) throw new Error('fixture is invalid')

  const cases: [string, Plan, number][] = [
    ['Sample home (150 m², 22 walls, 1 access point)', sample.plan, BUDGET_MS],
    ['Room grid (100 m², 60 walls, 2 access points)', roomGrid(), BUDGET_MS],
    [
      'Big house (300 m², 60 walls, 2 access points)',
      bigHouse(),
      LARGE_HOME_BUDGET_MS,
    ],
  ]
  const bands: Band[] = ['2.4GHz', '5GHz', '6GHz']

  for (const [name, plan, budget] of cases) {
    for (const band of bands) {
      it(`${name}, ${band}`, () => {
        const r = measure(plan, 'main', band)
        report(name, band, budget, r)
        expect(r.areaM2).toBeGreaterThanOrEqual(100)
        expect(r.median).toBeLessThan(budget * CI_MARGIN)
      })
    }
  }
})
