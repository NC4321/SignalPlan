import type { AccessPoint, Band, Plan, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  accessPointSightings,
  bssidSightings,
  chiSquaredQuantile95,
  locateSource,
  MODEL_SIGMA_DB,
  regionLimit,
  type Location,
} from './locate.ts'
import { bigHouse, roomSpots, simulate, twoStoreyHouse } from './testPlans.ts'

/**
 * Surveys with a hidden access point at a known position and power: the
 * readings are the model's own (`simulate`), plus noise where given.
 */
function hidden(
  plan: Plan,
  source: Partial<AccessPoint> & { x: number; y: number },
  spots: (floor: Plan['floors'][number], i: number) => SurveySpot[],
  sigmaDb = 0,
  seed = 1,
): Plan {
  const ap: AccessPoint = {
    id: 'hidden',
    name: 'Hidden',
    floorId: plan.floors[0]!.id,
    heightM: 1,
    radios: [
      { band: '2.4GHz', txPowerDbm: 17 },
      { band: '5GHz', txPowerDbm: 21 },
    ],
    ...source,
  }
  const surveyed: Plan = {
    ...plan,
    accessPoints: [ap],
    floors: plan.floors.map((floor, i) => ({
      ...floor,
      surveySpots: spots(floor, i).map((spot) => ({
        ...spot,
        readings: ap.radios.map((r) => ({
          apId: 'hidden',
          band: r.band,
          dbm: -60,
        })),
      })),
    })),
  }
  return simulate(surveyed, {}, 0, sigmaDb, seed)
}

const locate = (plan: Plan, band: Band = '5GHz', outside = false) =>
  locateSource(plan, band, accessPointSightings(plan, 'hidden', band), {
    outside,
  })

/** Six spots spread over the big house's 20 × 15 m. */
const sixSpots = (): SurveySpot[] =>
  [
    [2.3, 2.1],
    [10.4, 1.7],
    [17.6, 2.4],
    [2.6, 12.9],
    [9.7, 7.6],
    [17.3, 13.2],
  ].map(([x, y], i) => ({ id: `s${i}`, x: x!, y: y!, readings: [] }))

const distance = (l: Location, x: number, y: number) =>
  Math.hypot(l.x - x, l.y - y)

describe('locateSource', () => {
  it('needs readings at three spots', () => {
    const plan = hidden(bigHouse(), { x: 9.3, y: 7.7 }, () =>
      sixSpots().slice(0, 2),
    )
    expect(locate(plan)).toBeUndefined()
  })

  it('recovers a position and power exactly from noise-free readings', () => {
    for (const band of ['2.4GHz', '5GHz'] as Band[]) {
      const plan = hidden(bigHouse(), { x: 9.3, y: 7.7 }, sixSpots)
      const found = locate(plan, band)!
      expect(found.floorId).toBe('main')
      expect(distance(found, 9.3, 7.7)).toBeLessThan(0.01)
      expect(found.eirpDbm).toBeCloseTo(band === '5GHz' ? 21 : 17, 1)
      expect(found.eirpAtLimit).toBe(false)
      expect(found.rmsDb).toBeLessThan(0.05)
      expect(found.spots).toBe(6)
      expect(found.outside).toBe(false)
      // A perfect fit is still only as sure as the model.
      expect(found.sigmaDb).toBe(MODEL_SIGMA_DB)
      expect(found.uncertaintyM).toBeGreaterThan(0.5)
    }
  })

  it('finds the floor in a two-storey house', () => {
    const upstairs = hidden(
      twoStoreyHouse(),
      { floorId: 'up', x: 11.2, y: 3.3 },
      (_, i) => roomSpots(twoStoreyHouse(), 3, 2, `f${i}-`),
    )
    const found = locate(upstairs)!
    expect(found.floorId).toBe('up')
    expect(distance(found, 11.2, 3.3)).toBeLessThan(0.01)
    expect(found.eirpDbm).toBeCloseTo(21, 1)

    const downstairs = hidden(
      twoStoreyHouse(),
      { floorId: 'main', x: 2.2, y: 8.6 },
      (_, i) => roomSpots(twoStoreyHouse(), 3, 2, `f${i}-`),
    )
    expect(locate(downstairs)!.floorId).toBe('main')
  })

  it('places a neighbour outside the walls when allowed', () => {
    const plan = hidden(bigHouse(), { x: -4.2, y: 6.1 }, sixSpots)
    const found = locate(plan, '5GHz', true)!
    expect(distance(found, -4.2, 6.1)).toBeLessThan(0.01)
    expect(found.outside).toBe(true)
    expect(found.nearestWallM).toBeCloseTo(4.2, 1)
    // Inside only, the best it can do is against the outer wall.
    const inside = locate(plan, '5GHz', false)!
    expect(inside.x).toBeLessThan(1.5)
    expect(inside.rmsDb).toBeGreaterThan(found.rmsDb)
  })

  it('keeps the true position within its uncertainty with noise', () => {
    // 3 dB of noise on a spot in every room, ten surveys each. The region
    // is 95 %, but conservative (MODEL.md: 600 of 600 in the validation),
    // so none may miss. It must stay useful too: a few metres for an
    // access point inside, wider for a neighbour behind brick.
    const cases = [
      { x: 13.1, y: 4.4, outside: false, widest: 5 },
      { x: -4.2, y: 6.1, outside: true, widest: 15 },
    ]
    for (const { x, y, outside, widest } of cases) {
      for (let seed = 1; seed <= 10; seed++) {
        const plan = hidden(
          bigHouse(),
          { x, y },
          () => roomSpots(bigHouse(), 4, 3),
          3,
          seed,
        )
        const found = locate(plan, '5GHz', outside)!
        expect(found.floorId).toBe('main')
        expect(distance(found, x, y)).toBeLessThanOrEqual(found.uncertaintyM)
        expect(found.uncertaintyM).toBeLessThan(widest)
      }
    }
  })

  it('takes a calibration, device offset included', () => {
    const truth = { '5GHz': { pathLossExponent: 2.4, deviceOffsetDb: -5 } }
    const base = hidden(bigHouse(), { x: 6.6, y: 10.2 }, sixSpots)
    const plan = simulate(base, truth, 0, 0)
    // With the defaults, the readings don't fit exactly.
    expect(locate(plan)!.rmsDb).toBeGreaterThan(0.1)
    const calibrated = { ...plan, calibration: truth }
    const found = locate(calibrated)!
    expect(distance(found, 6.6, 10.2)).toBeLessThan(0.01)
    // The EIRP is the source's own, without the phone's offset.
    expect(found.eirpDbm).toBeCloseTo(21, 1)
  })

  it('keeps the power within the region’s limit', () => {
    const plan = hidden(bigHouse(), { x: 9.3, y: 7.7 }, sixSpots)
    const loud = {
      ...plan,
      floors: plan.floors.map((floor) => ({
        ...floor,
        surveySpots: floor.surveySpots!.map((spot) => ({
          ...spot,
          readings: spot.readings.map((r) => ({ ...r, dbm: r.dbm + 30 })),
        })),
      })),
    }
    const found = locate(loud)!
    expect(found.eirpDbm).toBe(36)
    expect(found.eirpAtLimit).toBe(true)
  })
})

describe('bssidSightings', () => {
  it('averages a device’s BSSIDs at each spot as power, by scans', () => {
    const plan: Plan = {
      ...bigHouse(),
      floors: bigHouse().floors.map((floor) => ({
        ...floor,
        surveySpots: [
          {
            id: 'a',
            x: 1,
            y: 2,
            readings: [],
            neighbourReadings: [
              { bssid: '02:00:00:00:00:01', band: '5GHz', dbm: -60, scans: 3 },
              { bssid: '02:00:00:00:00:02', band: '5GHz', dbm: -70 },
              { bssid: '02:00:00:00:00:01', band: '2.4GHz', dbm: -40 },
              { bssid: '02:00:00:00:00:09', band: '5GHz', dbm: -30 },
            ],
          },
          { id: 'b', x: 3, y: 4, readings: [] },
        ],
      })),
    }
    const sightings = bssidSightings(
      plan,
      ['02:00:00:00:00:01', '02:00:00:00:00:02'],
      '5GHz',
    )
    expect(sightings).toHaveLength(1)
    const expected = 10 * Math.log10((3 * 1e-6 + 1e-7) / 4)
    expect(sightings[0]).toEqual({
      floorId: 'main',
      x: 1,
      y: 2,
      dbm: expect.closeTo(expected, 10),
    })
  })
})

describe('regionLimit', () => {
  it('uses χ² quantiles close to the tables', () => {
    // 95th percentiles from the χ² tables.
    expect(chiSquaredQuantile95(2)).toBeCloseTo(5.99, 0)
    expect(chiSquaredQuantile95(5)).toBeCloseTo(11.07, 1)
    expect(chiSquaredQuantile95(24)).toBeCloseTo(36.42, 1)
  })

  it('takes the widest of its tests', () => {
    const sigma2 = MODEL_SIGMA_DB ** 2
    // A perfect fit at three spots: nothing estimated, so χ²₂ both ways.
    expect(regionLimit(3, 0)).toBeCloseTo(-2 * Math.log(0.05) * sigma2, 9)
    // Many readings fitted about as well as the model's scatter: the
    // error the model's scatter explains is the wider.
    expect(regionLimit(25, 22 * sigma2)).toBeCloseTo(
      chiSquaredQuantile95(24) * sigma2,
      9,
    )
    // Readings far noisier than the model: 2·F(2, 22; 95 %) = 6.88 times
    // their own scatter above the best.
    const noisy = 22 * 100
    expect(regionLimit(25, noisy)).toBeCloseTo(noisy + 6.88 * 100, -1)
  })
})
