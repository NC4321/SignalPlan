import { BANDS, parsePlan, type Plan } from '@signalplan/floorplan'
import surveyedHome from '@signalplan/floorplan/fixtures/surveyed-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { calibrateBand } from './calibration.ts'
import {
  simulate,
  SURVEYED_HOME_TRUTH,
  surveyedHomeSpots,
} from './testPlans.ts'

function load(): Plan {
  const result = parsePlan(surveyedHome)
  if (!result.ok) throw new Error('surveyed-home.json is invalid')
  return result.plan
}

describe('surveyed-home.json (D76)', () => {
  it('holds the model’s readings under its stated truth, a low phone and noise', () => {
    const plan = load()
    const blank: Plan = {
      ...plan,
      floors: plan.floors.map((f) => ({
        ...f,
        surveySpots: surveyedHomeSpots(plan),
      })),
    }
    const { calibration, offsetDb, sigmaDb, seed } = SURVEYED_HOME_TRUTH
    const expected = simulate(blank, calibration, offsetDb, sigmaDb, seed)
    const spots = plan.floors[0]!.surveySpots!
    expect(spots).toHaveLength(11)
    spots.forEach((spot, s) => {
      spot.readings.forEach((reading, r) => {
        const want = expected.floors[0]!.surveySpots![s]!.readings[r]!.dbm
        expect(Math.abs(reading.dbm - want)).toBeLessThanOrEqual(0.05 + 1e-9)
      })
    })
  })

  it('can be fitted on every band, and the fit beats the defaults', () => {
    const plan = load()
    for (const band of BANDS) {
      const { readiness, fit } = calibrateBand(plan, band)
      expect(readiness.ready).toBe(true)
      expect(fit!.after.rmsDb).toBeLessThan(fit!.before.rmsDb)
      // The phone reads about 5 dB low.
      expect(fit!.deviceOffsetDb.value).toBeLessThan(-2)
    }
  })
})
