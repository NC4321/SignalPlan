import type { AccessPoint, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { planChannels } from './channelPlan.ts'
import { ap, bigHouse, room } from './testPlans.ts'

/**
 * Speed of the channel planner against its 500 ms budget (D68), for every
 * band at once, with and without DFS. It runs on the page when Plan channels
 * is pressed, so it must not freeze the editor for long. The worst case is
 * many access points that all hear each other: 12 in one open room, where
 * 2.4 GHz can't keep them apart and the search has to prove the fewest
 * clashes. Run with `pnpm speed`; CI fails at 1.5× the budget (D26).
 */
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 500
const CI_MARGIN = 1.5

/** `n` access points on a 4-wide grid, with a radio on every band. */
function spread(plan: Plan, n: number, dx: number, dy: number): Plan {
  const accessPoints: AccessPoint[] = Array.from({ length: n }, (_, i) => ({
    ...ap(2 + (i % 4) * dx, 2 + Math.floor(i / 4) * dy),
    id: `a${i}`,
    floorId: plan.floors[0]!.id,
    radios: [{ band: '2.4GHz' }, { band: '5GHz' }, { band: '6GHz' }],
  }))
  return { ...plan, region: 'US', accessPoints }
}

describe('channel planner speed', () => {
  const homes = [
    { name: 'Big house, 8 access points', plan: spread(bigHouse(), 8, 5, 5) },
    {
      name: 'Open room, 12 access points that all hear each other',
      plan: spread(
        {
          schemaVersion: 1,
          name: 'Open room',
          floors: [room(30, 20)],
          accessPoints: [],
        },
        12,
        8,
        5,
      ),
    },
  ]
  for (const { name, plan } of homes) {
    for (const allowDfs of [false, true]) {
      it(`${name}, DFS ${allowDfs ? 'on' : 'off'}`, () => {
        const started = performance.now()
        const plans = planChannels({ ...plan, allowDfs })
        const ms = performance.now() - started
        console.log(
          `${name}, DFS ${allowDfs ? 'on' : 'off'}: ${ms.toFixed(0)} ms (budget ${BUDGET_MS} ms, CI limit ${BUDGET_MS * CI_MARGIN} ms); exact on ${plans.filter((p) => p.exact).length} of ${plans.length} bands`,
        )
        expect(plans).toHaveLength(3)
        // Up to this size the search finishes, so its plans are the best.
        expect(plans.every((p) => p.exact)).toBe(true)
        expect(ms).toBeLessThan(BUDGET_MS * CI_MARGIN)
      })
    }
  }
})
