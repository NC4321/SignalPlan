import type { Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { searchHowMany, searchMultiPlacement } from './multiSearch.ts'
import { searchSinglePlacement } from './search.ts'
import { bigHouse, gateHomes, twoStoreyHouse } from './testPlans.ts'

/**
 * Speed of the placement optimizer against the 10 s budget (D40), on the
 * exit gate homes, the 300 m² big house (D47) and the two-storey house,
 * scored over both floors (D55). Run with `pnpm speed`.
 *
 * The budget is for a desktop. Each search runs once with its own 10 s cap
 * lifted, so the real time is measured, and CI fails at 1.5× the budget, as
 * for the coverage grid (D26). The searches use Excellent (−50 dBm) on
 * 5 GHz, the strictest target, where every home needs extra access points
 * for the whole floor, so "how many" does the most work. Every search
 * starts from the plan's first access point; the big house's and the
 * two-storey house's second one is left out, so added ones may go on either
 * floor.
 */
// Both exist in Node and in Web Workers; the engine's lib has no DOM or Node types.
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 10_000
/** CI runners are slower and vary, so CI fails at 1.5× the budget (D26). */
const CI_MARGIN = 1.5
const EXCELLENT_DBM = -50

function problemFor(plan: Plan) {
  const router = plan.accessPoints[0]!
  return {
    plan,
    band: '5GHz' as const,
    minDbm: EXCELLENT_DBM,
    fixed: [],
    template: router,
    router,
  }
}

const searches: [string, (plan: Plan) => { kind: string }][] = [
  [
    'best spot for the router',
    (plan) => {
      const { router, ...problem } = problemFor(plan)
      return searchSinglePlacement(
        {
          ...problem,
          current: { x: router.x, y: router.y, floorId: router.floorId },
        },
        { budgetMs: Infinity },
      )
    },
  ],
  [
    'one more access point',
    (plan) => {
      const { router, ...problem } = problemFor(plan)
      return searchMultiPlacement(
        { ...problem, moving: [router], add: 1 },
        { budgetMs: Infinity },
      )
    },
  ],
  [
    'how many for 100%',
    (plan) => {
      const { router, ...problem } = problemFor(plan)
      return searchHowMany(
        { ...problem, moving: [router], goal: 1 },
        { budgetMs: Infinity },
      )
    },
  ],
]

describe('optimizer speed at Excellent on 5 GHz', () => {
  const homes = [
    ...gateHomes(),
    { name: 'Big house (300 m², 60 walls)', plan: bigHouse() },
    {
      name: 'Two-storey house (2 × 150 m², 60 walls each, stairwell)',
      plan: twoStoreyHouse(),
    },
  ]
  for (const { name, plan } of homes) {
    for (const [search, run] of searches) {
      it(`${name}: ${search}`, () => {
        const started = performance.now()
        const result = run(plan)
        const ms = performance.now() - started
        console.log(
          `${name}, ${search}: ${(ms / 1000).toFixed(2)} s (budget ${BUDGET_MS / 1000} s, CI limit ${(BUDGET_MS * CI_MARGIN) / 1000} s)`,
        )
        expect(result.kind).toBe('found')
        expect(ms).toBeLessThan(BUDGET_MS * CI_MARGIN)
      })
    }
  }
})
