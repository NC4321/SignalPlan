import { BANDS, parsePlan, type Plan } from '@signalplan/floorplan'
import surveyedHome from '@signalplan/floorplan/fixtures/surveyed-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { calibrateBand, type Calibration } from './calibration.ts'
import { predictReadings, summariseErrors } from './survey.ts'
import { simulate, surveyedTwoStorey } from './testPlans.ts'

/**
 * Phase 7 exit gate, automated part (D70, D78): on homes whose readings
 * come from known values plus a phone offset and noise, calibration clearly
 * lowers the held-out error on every band, and the error report shows it
 * once the fit is applied. Apply here is Calibrate's rule (D76): a band's
 * fit is saved only if it beats the defaults held out. The other half of the
 * gate, a survey of a real home, is recorded in MODEL.md.
 */

function load(json: unknown): Plan {
  const result = parsePlan(json)
  if (!result.ok) throw new Error('fixture is invalid')
  return result.plan
}

/** The plan after Calibrate's Apply, from the defaults. */
function applied(plan: Plan): Plan {
  const calibration: Calibration = {}
  for (const band of BANDS) {
    const { fit } = calibrateBand(plan, band)
    if (fit && fit.after.rmsDb < fit.before.rmsDb) {
      calibration[band] = fit.calibration
    }
  }
  return { ...plan, calibration }
}

/** The error report's summary for each band, by band. */
function report(plan: Plan, calibration?: Calibration) {
  return new Map(
    summariseErrors(predictReadings(plan, calibration)).map((s) => [s.band, s]),
  )
}

/**
 * Drywall off its default on 2.4 GHz (lossier) and 5 GHz (less lossy), a
 * lossier timber floor on 5 GHz, and a path loss exponent off 2 on every
 * band: the model starts 7–10 dB out.
 */
const TWO_STOREY_TRUTH: Calibration = {
  '2.4GHz': { pathLossExponent: 2.3, wallLossDb: { drywall: 4 } },
  '5GHz': {
    pathLossExponent: 2.1,
    wallLossDb: { drywall: 2 },
    floorLossDb: { 'timber-joist': 5 },
  },
  '6GHz': { pathLossExponent: 2.2 },
}

describe('Phase 7 exit gate', () => {
  it('halves the held-out error on every band of surveyed-home.json', () => {
    // n = 2.25, a phone 5 dB low and 2 dB of noise (D76).
    const plan = load(surveyedHome)
    for (const band of BANDS) {
      const { readiness, fit } = calibrateBand(plan, band)
      expect(readiness.ready).toBe(true)
      expect(fit!.before.rmsDb).toBeGreaterThan(5)
      expect(fit!.after.rmsDb).toBeLessThan(fit!.before.rmsDb / 2)
      expect(fit!.after.rmsDb).toBeLessThan(3)
    }
  })

  it('shows the improvement in the error report once applied', () => {
    const plan = load(surveyedHome)
    const before = report(plan, {})
    const after = report(applied(plan))
    for (const band of BANDS) {
      // Before: the model is 6–7 dB too hopeful, as the phone reads low.
      expect(before.get(band)!.meanDb).toBeGreaterThan(5)
      // After: no bias, and errors about the size of the noise.
      expect(Math.abs(after.get(band)!.meanDb)).toBeLessThan(0.5)
      expect(after.get(band)!.rmsDb).toBeLessThan(2.5)
      expect(after.get(band)!.rmsDb).toBeLessThan(before.get(band)!.rmsDb / 2)
    }
  })

  it('does the same on two storeys with walls and a floor off their defaults, through 3 dB of noise', () => {
    for (const seed of [1, 2, 3]) {
      const plan = simulate(surveyedTwoStorey(), TWO_STOREY_TRUTH, -5, 3, seed)
      const before = report(plan, {})
      const after = report(applied(plan))
      for (const band of BANDS) {
        const { fit } = calibrateBand(plan, band)
        expect(fit!.after.rmsDb).toBeLessThan(fit!.before.rmsDb / 2)
        expect(fit!.after.rmsDb).toBeLessThan(3.6)
        expect(after.get(band)!.rmsDb).toBeLessThan(before.get(band)!.rmsDb / 2)
      }
    }
  })

  it('never makes the error report worse where the defaults were right', () => {
    // Readings from the defaults with noise alone: there's nothing to fix,
    // so a band is either left alone or applied without harm.
    for (const seed of [4, 5, 6]) {
      const plan = simulate(surveyedTwoStorey(), {}, 0, 3, seed)
      const before = report(plan, {})
      const after = report(applied(plan))
      for (const band of BANDS) {
        expect(after.get(band)!.rmsDb).toBeLessThanOrEqual(
          before.get(band)!.rmsDb + 1e-9,
        )
      }
    }
  })
})
