import { parsePlan, type Band, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { evaluateCoverage } from './coverage.ts'
import { sinrDb, sourceTunings } from './interference.ts'
import { bigHouse, roomGrid, twoStoreyHouse } from './testPlans.ts'

/**
 * Speed of the coverage grid against the Phase 2 budget: a 100 m² floor at
 * 10 cm cells in under 200 ms (OUTLINE.md, D11). Run with `pnpm speed`, one
 * file at a time so other tests don't compete for the CPU.
 *
 * The budget is for a Web Worker on a laptop, but this check runs on CI.
 * GitHub's ubuntu-latest runners measure about 1.8–2.1× slower than a desktop
 * i5-12600K, and runner hardware varies, so CI fails at 1.5× each budget (D26).
 * Large homes have a tighter budget: 200 ms on a device 4× slower than the
 * desktop (D29). Timings are in docs/MODEL.md; each result prints its budget.
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

function measure(plan: Plan, floorId: string, band: Band, sinr = false) {
  const run = () => {
    const coverage = evaluateCoverage(plan, floorId, band)
    if (sinr) sinrDb(coverage, sourceTunings(coverage, plan))
    return coverage
  }
  for (let i = 0; i < WARM_UP_RUNS; i++) run()
  const times: number[] = []
  let cells = 0
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    const coverage = run()
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

  const cases: [string, Plan, string, number][] = [
    [
      'Sample home (150 m², 22 walls, 1 access point)',
      sample.plan,
      'main',
      BUDGET_MS,
    ],
    [
      'Room grid (100 m², 60 walls, 2 access points)',
      roomGrid(),
      'main',
      BUDGET_MS,
    ],
    [
      'Big house (300 m², 60 walls, 2 access points)',
      bigHouse(),
      'main',
      LARGE_HOME_BUDGET_MS,
    ],
    // Each floor counts both access points, one of them through the floor.
    [
      'Two-storey house, ground floor (2 × 150 m², 60 walls each, 1 access point per floor, stairwell)',
      twoStoreyHouse(),
      'main',
      LARGE_HOME_BUDGET_MS,
    ],
    [
      'Two-storey house, upstairs (2 × 150 m², 60 walls each, 1 access point per floor, stairwell)',
      twoStoreyHouse(),
      'up',
      LARGE_HOME_BUDGET_MS,
    ],
  ]
  const bands: Band[] = ['2.4GHz', '5GHz', '6GHz']

  for (const [name, plan, floorId, budget] of cases) {
    for (const band of bands) {
      it(`${name}, ${band}`, () => {
        const r = measure(plan, floorId, band)
        report(name, band, budget, r)
        expect(r.areaM2).toBeGreaterThanOrEqual(100)
        expect(r.median).toBeLessThan(budget * CI_MARGIN)
      })
    }
  }
})

/**
 * The Interference view works SINR out on the page from the grid (D66), so
 * the grid and SINR together keep to the large-home budget. Every access
 * point shares one channel, so each cell adds up an interferer.
 */
describe('coverage grid plus SINR speed at 10 cm cells', () => {
  const sameChannel = (plan: Plan): Plan => ({
    ...plan,
    accessPoints: plan.accessPoints.map((ap) => ({
      ...ap,
      radios: ap.radios.map((radio) => ({
        ...radio,
        channel: radio.band === '2.4GHz' ? 6 : radio.band === '5GHz' ? 42 : 7,
        channelWidthMHz: radio.band === '2.4GHz' ? 20 : 80,
      })),
    })),
  })
  const cases: [string, Plan, string][] = [
    ['Big house (300 m², 2 access points)', sameChannel(bigHouse()), 'main'],
    [
      'Two-storey house, ground floor (1 access point per floor)',
      sameChannel(twoStoreyHouse()),
      'main',
    ],
  ]
  const bands: Band[] = ['2.4GHz', '5GHz', '6GHz']
  for (const [name, plan, floorId] of cases) {
    for (const band of bands) {
      it(`${name}, ${band}, with SINR`, () => {
        const r = measure(plan, floorId, band, true)
        report(`${name} with SINR`, band, LARGE_HOME_BUDGET_MS, r)
        expect(r.median).toBeLessThan(LARGE_HOME_BUDGET_MS * CI_MARGIN)
      })
    }
  }
})
