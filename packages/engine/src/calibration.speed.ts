import type { Band } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { calibrateBand } from './calibration.ts'
import { simulate, surveyedBigHouse, surveyedTwoStorey } from './testPlans.ts'

/**
 * Speed of the calibration fit against its budget (D75), one band at a time
 * as Calibrate runs it, leave-one-out included: a fit per spot plus the
 * whole. The largest survey is a spot in every room of the two-storey house,
 * 50 spots and 100 readings a band, far more than a home survey needs. It
 * runs in a worker; about 10 ms on a desktop, so the budget is set to catch
 * a slowdown rather than to bound a wait. Run with `pnpm speed`; CI fails
 * at 1.5× the budget (D26).
 */
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 100
const CI_MARGIN = 1.5
const RUNS = 5

describe('calibration speed', () => {
  const truth = {
    '2.4GHz': { pathLossExponent: 2.2 },
    '5GHz': { pathLossExponent: 2.2 },
    '6GHz': { pathLossExponent: 2.2 },
  }
  const homes = [
    {
      name: 'Big house, 25 spots, 2 access points',
      plan: simulate(surveyedBigHouse(), truth, -5, 3),
    },
    {
      name: 'Two-storey house, 50 spots, 2 access points',
      plan: simulate(surveyedTwoStorey(), truth, -5, 3),
    },
  ]
  for (const { name, plan } of homes) {
    for (const band of ['2.4GHz', '5GHz', '6GHz'] as Band[]) {
      it(`${name}, ${band}`, () => {
        calibrateBand(plan, band)
        const times: number[] = []
        for (let i = 0; i < RUNS; i++) {
          const started = performance.now()
          const { fit } = calibrateBand(plan, band)
          times.push(performance.now() - started)
          expect(fit).toBeDefined()
        }
        times.sort((a, b) => a - b)
        const median = times[Math.floor(RUNS / 2)]!
        console.log(
          `${name}, ${band}: ${median.toFixed(0)} ms median (budget ${BUDGET_MS} ms, CI limit ${BUDGET_MS * CI_MARGIN} ms)`,
        )
        expect(median).toBeLessThan(BUDGET_MS * CI_MARGIN)
      })
    }
  }
})
