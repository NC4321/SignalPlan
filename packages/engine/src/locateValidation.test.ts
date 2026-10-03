import {
  parsePlan,
  type Band,
  type Plan,
  type SurveySpot,
} from '@signalplan/floorplan'
import surveyedHome from '@signalplan/floorplan/fixtures/surveyed-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { locateTransmitter, type LocateReading } from './locate.ts'
import { predictReadings } from './survey.ts'
import { bigHouse, gaussian, roomSpots } from './testPlans.ts'

/**
 * Validation of locating transmitters (D83), quoted in MODEL.md: synthetic
 * surveys of transmitters at known positions, inside the home and next door,
 * read from the model plus Gaussian noise, located with the noise level as
 * the model's error. For each case it measures how far the fit lands from
 * the truth and how often the truth is within the stated uncertainty.
 */

function bungalow(): Plan {
  const result = parsePlan(surveyedHome)
  if (!result.ok) throw new Error('surveyed-home.json is invalid')
  return result.plan
}

interface Case {
  name: string
  plan: Plan
  spots: SurveySpot[]
  truths: { x: number; y: number; eirpDbm: number; outside: boolean }[]
}

const home = bungalow()
const house = bigHouse()
const CASES: Case[] = [
  {
    name: 'Surveyed bungalow, 11 spots',
    plan: home,
    spots: home.floors[0]!.surveySpots!,
    truths: [
      { x: 4.2, y: 6.1, eirpDbm: 20, outside: false },
      { x: 11.3, y: 3.4, eirpDbm: 17, outside: false },
      { x: -5, y: 4, eirpDbm: 20, outside: true },
      { x: 9, y: 16, eirpDbm: 20, outside: true },
    ],
  },
  {
    name: 'Big house, 25 spots',
    plan: house,
    spots: roomSpots(house, 4, 3),
    truths: [
      { x: 9.3, y: 7.6, eirpDbm: 20, outside: false },
      { x: 2.1, y: 13.2, eirpDbm: 17, outside: false },
      { x: -6.2, y: 5.3, eirpDbm: 20, outside: true },
      { x: 12, y: 24, eirpDbm: 20, outside: true },
    ],
  },
]

function readings(
  c: Case,
  truth: Case['truths'][number],
  band: Band,
  sigmaDb: number,
  seed: number,
): LocateReading[] {
  const floorId = c.plan.floors[0]!.id
  const noise = gaussian(seed)
  const plan: Plan = {
    ...c.plan,
    calibration: undefined,
    accessPoints: [
      {
        id: 't',
        name: 'T',
        floorId,
        x: truth.x,
        y: truth.y,
        heightM: 1,
        radios: [{ band, txPowerDbm: truth.eirpDbm }],
      },
    ],
    floors: [
      {
        ...c.plan.floors[0]!,
        surveySpots: c.spots.map((s) => ({
          ...s,
          readings: [{ apId: 't', band, dbm: -60 }],
        })),
      },
    ],
  }
  const at = new Map(c.spots.map((s) => [s.id, s]))
  return predictReadings(plan).map((r) => ({
    floorId,
    x: at.get(r.spotId)!.x,
    y: at.get(r.spotId)!.y,
    dbm: r.predictedDbm + sigmaDb * noise(),
  }))
}

const SEEDS = 10
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}

describe('locating transmitters on synthetic surveys (D83)', () => {
  for (const c of CASES) {
    for (const sigmaDb of [2, 3]) {
      it(`${c.name}, ${sigmaDb} dB of noise`, () => {
        const plan = { ...c.plan, calibration: undefined }
        const inside: number[] = []
        const outside: number[] = []
        const radii: number[] = []
        let within = 0
        let total = 0
        c.truths.forEach((truth, t) => {
          for (let seed = 1; seed <= SEEDS; seed++) {
            const found = locateTransmitter(
              plan,
              '5GHz',
              readings(c, truth, '5GHz', sigmaDb, seed + 100 * t),
              { modelErrorDb: sigmaDb },
            )!
            const off = Math.hypot(found.x - truth.x, found.y - truth.y)
            ;(truth.outside ? outside : inside).push(off)
            radii.push(found.uncertaintyM)
            total++
            if (off <= found.uncertaintyM) within++
          }
        })
        const figures = {
          case: c.name,
          sigmaDb,
          insideMedianM: percentile(inside, 0.5),
          insideP90M: percentile(inside, 0.9),
          outsideMedianM: percentile(outside, 0.5),
          outsideP90M: percentile(outside, 0.9),
          medianUncertaintyM: percentile(radii, 0.5),
          withinShare: within / total,
        }
        // The figures MODEL.md quotes: in all four, the truth was within
        // the uncertainty in 95–100% of surveys, and the median distance
        // from it 0.4–0.8 m inside the home and 0.9–1.8 m outside.
        expect(figures.withinShare).toBeGreaterThanOrEqual(0.9)
        expect(figures.insideMedianM).toBeLessThan(1)
        expect(figures.outsideMedianM).toBeLessThan(2.5)
      })
    }
  }
})
