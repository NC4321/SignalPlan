import type { Calibration, Plan, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { calibrateBand } from './calibration.ts'
import { accessPointLinks } from './channelPlan.ts'
import { cellCentre, evaluateCoverage } from './coverage.ts'
import { summariseCoverage } from './floorArea.ts'
import { createScorer } from './placement.ts'
import { predictReadings } from './survey.ts'
import {
  ap,
  freeSpaceDbm,
  room,
  simulate,
  surveyedBigHouse,
  twoStoreyHouse,
} from './testPlans.ts'

/**
 * A plan's own calibration (D76) reaches everything that uses the model:
 * the heatmap, the optimizer, the channel planner and the error report.
 */

const CALIBRATION: Calibration = {
  '5GHz': {
    pathLossExponent: 2.2,
    wallLossDb: { drywall: 4, brick: 12 },
    floorLossDb: { 'timber-joist': 5.5 },
    deviceOffsetDb: -6,
  },
}

const calibrated = (plan: Plan): Plan => ({ ...plan, calibration: CALIBRATION })

describe('a calibrated plan (D76)', () => {
  it('gives the heatmap the error report’s prediction, without the device offset', () => {
    const plan = calibrated(twoStoreyHouse())
    for (const floor of plan.floors) {
      const coverage = evaluateCoverage(plan, floor.id, '5GHz')
      const { grid } = coverage
      const size = grid.cols * grid.rows
      // A spot at the centre of every 37th cell, read from every access point.
      const spots: SurveySpot[] = []
      for (let i = 0; i < size; i += 37) {
        const at = cellCentre(grid, i % grid.cols, Math.floor(i / grid.cols))
        spots.push({
          id: `c${i}`,
          ...at,
          readings: plan.accessPoints.map((a) => ({
            apId: a.id,
            band: '5GHz',
            dbm: -60,
          })),
        })
      }
      const surveyed: Plan = {
        ...plan,
        floors: plan.floors.map((f) =>
          f.id === floor.id ? { ...f, surveySpots: spots } : f,
        ),
      }
      const readings = predictReadings(surveyed)
      expect(readings).toHaveLength(spots.length * plan.accessPoints.length)
      for (const reading of readings) {
        const cell = Number(reading.spotId.slice(1))
        const source = coverage.accessPointIds.indexOf(reading.apId)
        expect(coverage.sourceDbm[source * size + cell]).toBeCloseTo(
          reading.predictedDbm + 6,
          3,
        )
      }
    }
  })

  it('changes the heatmap from the defaults', () => {
    const plan = twoStoreyHouse()
    const before = evaluateCoverage(plan, 'up', '5GHz')
    const after = evaluateCoverage(calibrated(plan), 'up', '5GHz')
    const changed = after.dbm.filter((v, i) => Math.abs(v - before.dbm[i]!) > 1)
    expect(changed.length).toBeGreaterThan(after.dbm.length / 2)
    // Other bands keep their defaults.
    expect(evaluateCoverage(calibrated(plan), 'up', '2.4GHz').dbm).toEqual(
      evaluateCoverage(plan, 'up', '2.4GHz').dbm,
    )
  })

  it('scores the optimizer’s spots as the heatmap shows them', () => {
    const plan = calibrated(twoStoreyHouse())
    const router = plan.accessPoints[0]!
    const scorer = createScorer({
      plan,
      band: '5GHz',
      minDbm: -67,
      fixed: plan.accessPoints.slice(1),
      template: router,
      cellM: 0.25,
    })!
    const share = scorer.share([scorer.signal(router)])
    let covered = 0
    let area = 0
    for (const floor of plan.floors) {
      const summary = summariseCoverage(
        evaluateCoverage(plan, floor.id, '5GHz', 0.25),
        -67,
      )
      covered += summary.share! * summary.areaM2
      area += summary.areaM2
    }
    expect(share).toBeCloseTo(covered / area, 9)
  })

  it('gives the channel planner the calibrated exponent', () => {
    const open: Plan = {
      schemaVersion: 1,
      name: 'Open',
      floors: [room(30, 10)],
      accessPoints: [ap(5, 5), ap(15, 5)],
    }
    const nodes = (plan: Plan) =>
      plan.accessPoints.map((a) => ({ ap: a, radio: a.radios[0]! }))
    const before = accessPointLinks(open, '5GHz', nodes(open))[0]![1]!
    const plan = calibrated(open)
    const after = accessPointLinks(plan, '5GHz', nodes(plan))[0]![1]!
    expect(before).toBeCloseTo(freeSpaceDbm(10), 9)
    expect(after - before).toBeCloseTo(-10 * 0.2 * Math.log10(10), 9)
  })

  it('adds the device offset to the error report’s predictions only', () => {
    const plan = surveyedBigHouse()
    const { deviceOffsetDb: _, ...rest } = CALIBRATION['5GHz']!
    const withOffset = predictReadings(calibrated(plan))
    const without = predictReadings({
      ...plan,
      calibration: { '5GHz': rest },
    })
    withOffset.forEach((r, i) => {
      expect(r.predictedDbm - without[i]!.predictedDbm).toBeCloseTo(
        r.band === '5GHz' ? -6 : 0,
        9,
      )
    })
    // `{}` gives the defaults, whatever the plan is calibrated to.
    expect(predictReadings(calibrated(plan), {})).toEqual(predictReadings(plan))
  })

  it('doesn’t change the fit, which always starts from the defaults', () => {
    const truth: Calibration = { '5GHz': { pathLossExponent: 2.2 } }
    const plan = simulate(surveyedBigHouse(), truth, -5, 1)
    const fresh = calibrateBand(plan, '5GHz')
    expect(calibrateBand(calibrated(plan), '5GHz')).toEqual(fresh)
    expect(fresh.fit!.calibration.deviceOffsetDb).toBe(
      fresh.fit!.deviceOffsetDb.value,
    )
  })
})
