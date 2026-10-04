import type { AccessPoint, Plan, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { accessPointSightings, locateSource } from './locate.ts'
import { roomSpots, simulate, twoStoreyHouse } from './testPlans.ts'

/**
 * Speed of locating one source against its budget (D83): a neighbour in the
 * two-storey house, so both floors are searched with 10 m of outside around
 * them, from 10 spots (a quick survey) and from 50 (a spot in every room,
 * far more than a survey needs). It runs in a worker, once for each device
 * and band. Run with `pnpm speed`; CI fails at 1.5× the budget (D26).
 */
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 200
const CI_MARGIN = 1.5
const RUNS = 5

function surveyed(spots: SurveySpot[][]): Plan {
  const plan = twoStoreyHouse()
  const neighbour: AccessPoint = {
    id: 'neighbour',
    name: 'Next door',
    floorId: 'up',
    x: -3.4,
    y: 6.2,
    heightM: 1,
    radios: [{ band: '5GHz', txPowerDbm: 21 }],
  }
  return simulate(
    {
      ...plan,
      accessPoints: [neighbour],
      floors: plan.floors.map((floor, i) => ({
        ...floor,
        surveySpots: spots[i]!.map((spot) => ({
          ...spot,
          readings: [{ apId: 'neighbour', band: '5GHz' as const, dbm: -60 }],
        })),
      })),
    },
    {},
    0,
    3,
  )
}

describe('locate speed', () => {
  const all = [0, 1].map((i) => roomSpots(twoStoreyHouse(), 3, 2, `f${i}-`))
  const homes = [
    {
      name: 'Two-storey house, 10 spots',
      plan: surveyed(all.map((spots) => spots.filter((_, i) => i % 5 === 2))),
    },
    { name: 'Two-storey house, 50 spots', plan: surveyed(all) },
  ]
  for (const { name, plan } of homes) {
    it(name, () => {
      const sightings = accessPointSightings(plan, 'neighbour', '5GHz')
      const options = { outside: true }
      locateSource(plan, '5GHz', sightings, options)
      const times: number[] = []
      for (let i = 0; i < RUNS; i++) {
        const started = performance.now()
        const found = locateSource(plan, '5GHz', sightings, options)
        times.push(performance.now() - started)
        expect(found).toBeDefined()
      }
      times.sort((a, b) => a - b)
      const median = times[Math.floor(RUNS / 2)]!
      console.log(
        `${name}: ${median.toFixed(0)} ms median (budget ${BUDGET_MS} ms, CI limit ${BUDGET_MS * CI_MARGIN} ms)`,
      )
      expect(median).toBeLessThan(BUDGET_MS * CI_MARGIN)
    })
  }
})
