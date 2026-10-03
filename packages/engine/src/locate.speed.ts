import type { Plan, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { locateTransmitter, type LocateReading } from './locate.ts'
import { predictReadings } from './survey.ts'
import { bigHouse, roomSpots, twoStoreyHouse } from './testPlans.ts'

/**
 * Speed of locating one transmitter against its budget (D83): the search
 * over the home and 20 m around it, refined, with its uncertainty. The
 * largest case is a neighbour heard at every spot of the two-storey house,
 * 50 spots on two floors, far more than a home survey needs (the surveyed
 * bungalow has 11). It runs in a worker, once per network; about 150 ms on a
 * desktop for 50 spots and a third of that for 25, so a dozen neighbours
 * from a typical survey take well under a second. Run with `pnpm speed`; CI
 * fails at 1.5× the budget (D26).
 */
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 200
const CI_MARGIN = 1.5
const RUNS = 5

/** Readings of a 20 dBm transmitter at (x, y) on `floorId`, from the model. */
function readings(
  plan: Plan,
  floorId: string,
  x: number,
  y: number,
  spots: SurveySpot[][],
): LocateReading[] {
  const withSource: Plan = {
    ...plan,
    accessPoints: [
      {
        id: 't',
        name: 'T',
        floorId,
        x,
        y,
        heightM: 1,
        radios: [{ band: '5GHz', txPowerDbm: 20 }],
      },
    ],
    floors: plan.floors.map((floor, i) => ({
      ...floor,
      surveySpots: spots[i]!.map((s) => ({
        ...s,
        readings: [{ apId: 't', band: '5GHz' as const, dbm: -60 }],
      })),
    })),
  }
  const at = new Map(spots.flat().map((s) => [s.id, s]))
  return predictReadings(withSource).map((r) => ({
    floorId: r.floorId,
    x: at.get(r.spotId)!.x,
    y: at.get(r.spotId)!.y,
    dbm: r.predictedDbm,
  }))
}

describe('locate speed', () => {
  const big = bigHouse()
  const two = twoStoreyHouse()
  const cases = [
    {
      name: 'Big house, 25 spots, a neighbour outside',
      plan: big,
      readings: readings(big, big.floors[0]!.id, -5, 6, [roomSpots(big, 4, 3)]),
    },
    {
      name: 'Two-storey house, 50 spots, a transmitter upstairs',
      plan: two,
      readings: readings(
        two,
        'up',
        3.4,
        8.2,
        two.floors.map((_, i) => roomSpots(two, 3, 2, `f${i}-`)),
      ),
    },
  ]
  for (const { name, plan, readings: heard } of cases) {
    it(name, () => {
      locateTransmitter(plan, '5GHz', heard, { modelErrorDb: 3 })
      const times: number[] = []
      for (let i = 0; i < RUNS; i++) {
        const started = performance.now()
        const found = locateTransmitter(plan, '5GHz', heard, {
          modelErrorDb: 3,
        })
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
