import type { Band, Plan, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { cellCentre, evaluateCoverage } from './coverage.ts'
import { MATERIAL_LOSS_DB } from './materials.ts'
import {
  predictReadings,
  spotErrors,
  summariseErrors,
  worstSpots,
  type ReadingError,
} from './survey.ts'
import { ap, freeSpaceDbm, room, twoStoreyHouse } from './testPlans.ts'

function plan(spots: SurveySpot[]): Plan {
  const floor = room(10, 6, { x: 5, material: 'brick' })
  return {
    schemaVersion: 1,
    name: 'Test',
    floors: [{ ...floor, surveySpots: spots }],
    accessPoints: [{ ...ap(2, 3), id: 'ap' }],
  }
}

const spot = (
  id: string,
  x: number,
  y: number,
  readings: { apId?: string; band?: Band; dbm: number }[],
): SurveySpot => ({
  id,
  x,
  y,
  readings: readings.map((r) => ({
    apId: r.apId ?? 'ap',
    band: r.band ?? '5GHz',
    dbm: r.dbm,
  })),
})

describe('predictReadings', () => {
  it('predicts free space in the same room, and subtracts the reading', () => {
    // 3 m from the access point (2.4 m across, 1.8 m down), both 1 m up:
    // 23 dBm EIRP − 47.29 dB at 1 m (5.5225 GHz) − 20·log10(3) = −33.83 dBm.
    const [error] = predictReadings(plan([spot('s', 4.4, 4.8, [{ dbm: -40 }])]))
    expect(error!.predictedDbm).toBeCloseTo(-33.83, 1)
    expect(error!.predictedDbm).toBeCloseTo(freeSpaceDbm(3), 9)
    expect(error!.measuredDbm).toBe(-40)
    expect(error!.approximate).toBe(false)
    // Predicted − measured: the model is 6.2 dB too hopeful here.
    expect(error!.errorDb).toBeCloseTo(6.17, 1)
  })

  it('pays the walls between the access point and the spot', () => {
    // From (2, 3) to (8, 3): 6 m, through the brick wall at x = 5.
    const [error] = predictReadings(plan([spot('s', 8, 3, [{ dbm: -70 }])]))
    const brick = MATERIAL_LOSS_DB['5GHz'].brick
    expect(error!.predictedDbm).toBeCloseTo(freeSpaceDbm(6) - brick, 9)
    expect(error).toMatchObject({
      spotId: 's',
      floorId: 'f',
      index: 0,
      apId: 'ap',
      band: '5GHz',
    })
  })

  it('says which readings were converted from a percentage (D82)', () => {
    const p = plan([spot('s', 8, 3, [{ dbm: -70 }])])
    p.floors[0]!.surveySpots![0]!.readings[0]!.approximate = true
    expect(predictReadings(p)[0]!.approximate).toBe(true)
  })

  it('leaves out readings of a band the access point has turned off', () => {
    const errors = predictReadings(
      plan([
        spot('s', 8, 3, [
          { band: '2.4GHz', dbm: -60 },
          { dbm: -70 },
          { apId: 'gone', dbm: -70 },
        ]),
      ]),
    )
    expect(errors.map((e) => [e.band, e.index])).toEqual([['5GHz', 1]])
  })

  it('matches the heatmap at a cell centre on another floor', () => {
    const house = twoStoreyHouse()
    const up = house.floors.find((f) => f.id === 'up')!
    const coverage = evaluateCoverage(house, 'up', '5GHz')
    // A cell centre near the far end, well away from the stairwell.
    const col = Math.floor(coverage.grid.cols * 0.8)
    const row = Math.floor(coverage.grid.rows * 0.3)
    const at = cellCentre(coverage.grid, col, row)
    const readings = coverage.accessPointIds.map((apId) => ({
      apId,
      band: '5GHz' as const,
      dbm: -60,
    }))
    up.surveySpots = [{ id: 's', x: at.x, y: at.y, readings }]
    const errors = predictReadings(house)
    const size = coverage.grid.cols * coverage.grid.rows
    const i = row * coverage.grid.cols + col
    expect(errors).toHaveLength(coverage.accessPointIds.length)
    errors.forEach((error, source) => {
      // The heatmap stores Float32, so it agrees to its precision.
      expect(error.predictedDbm).toBeCloseTo(
        coverage.sourceDbm[source * size + i]!,
        4,
      )
    })
    // One of them comes from downstairs, through the timber joist floor.
    expect(new Set(house.accessPoints.map((a) => a.floorId)).size).toBe(2)
  })
})

const reading = (
  spotId: string,
  band: Band,
  errorDb: number,
  approximate = false,
): ReadingError => ({
  spotId,
  floorId: 'f',
  index: 0,
  apId: 'ap',
  band,
  measuredDbm: -60,
  approximate,
  predictedDbm: -60 + errorDb,
  errorDb,
})

describe('summariseErrors', () => {
  it('gives each band its mean and RMS error and count', () => {
    const summary = summariseErrors([
      reading('a', '5GHz', 2),
      reading('b', '5GHz', -4),
      reading('c', '5GHz', 5, true),
      reading('a', '2.4GHz', -3),
    ])
    // 5 GHz: mean (2 − 4 + 5)/3 = 1; RMS √((4 + 16 + 25)/3) = √15.
    expect(summary).toHaveLength(2)
    expect(summary[0]).toMatchObject({ band: '2.4GHz', count: 1, meanDb: -3 })
    expect(summary[0]!.rmsDb).toBeCloseTo(3, 12)
    expect(summary[1]).toMatchObject({
      band: '5GHz',
      count: 3,
      approximate: 1,
      meanDb: 1,
    })
    expect(summary[0]!.approximate).toBe(0)
    expect(summary[1]!.rmsDb).toBeCloseTo(Math.sqrt(15), 12)
  })

  it('is empty without readings', () => {
    expect(summariseErrors([])).toEqual([])
  })
})

describe('spotErrors and worstSpots', () => {
  const errors = [
    reading('a', '5GHz', 2),
    reading('a', '5GHz', -6),
    reading('a', '2.4GHz', 1),
    reading('b', '5GHz', 3),
    reading('c', '6GHz', -7),
    reading('d', '5GHz', 0.5),
  ]

  it('averages each spot on each band', () => {
    expect(
      spotErrors(errors).map((e) => [e.spotId, e.band, e.count, e.meanDb]),
    ).toEqual([
      ['a', '2.4GHz', 1, 1],
      ['a', '5GHz', 2, -2],
      ['b', '5GHz', 1, 3],
      ['c', '6GHz', 1, -7],
      ['d', '5GHz', 1, 0.5],
    ])
  })

  it('ranks spots by their furthest-off band, each once', () => {
    expect(worstSpots(errors, 5).map((e) => [e.spotId, e.band])).toEqual([
      ['c', '6GHz'],
      ['b', '5GHz'],
      ['a', '5GHz'],
      ['d', '5GHz'],
    ])
    expect(worstSpots(errors, 2).map((e) => e.spotId)).toEqual(['c', 'b'])
  })
})
