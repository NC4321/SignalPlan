import type { Band, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  calibrateBand,
  defaultValues,
  MIN_DISTANCE_SPREAD_DB,
  MIN_SPOT_SEPARATION_M,
  MIN_SPOTS,
  predictPath,
  surveyPaths,
  surveyReadiness,
  type Calibration,
  type ModelValues,
} from './calibration.ts'
import {
  DEVICE_OFFSET_LIMITS_DB,
  EXPONENT_LIMITS,
  floorLimitsDb,
  wallLimitsDb,
} from './calibrationLimits.ts'
import { FLOOR_LOSS_DB, MATERIAL_LOSS_DB } from './materials.ts'
import { predictReadings } from './survey.ts'
import {
  ap,
  room,
  simulate,
  surveyedBigHouse,
  surveyedTwoStorey,
  twoStoreyHouse,
} from './testPlans.ts'

describe('surveyPaths', () => {
  it('reproduces predictReadings exactly with the default values', () => {
    for (const plan of [surveyedBigHouse(), surveyedTwoStorey()]) {
      for (const band of ['2.4GHz', '5GHz', '6GHz'] as Band[]) {
        const paths = surveyPaths(plan, band)
        const expected = predictReadings(plan).filter((r) => r.band === band)
        expect(paths).toHaveLength(expected.length)
        const values = defaultValues(band)
        paths.forEach((path, i) => {
          expect(path.spotId).toBe(expected[i]!.spotId)
          expect(predictPath(path, values)).toBeCloseTo(
            expected[i]!.predictedDbm,
            9,
          )
        })
      }
    }
  })

  it('follows predictReadings with calibrated values too', () => {
    const plan = surveyedTwoStorey()
    const calibration: Calibration = {
      '5GHz': {
        pathLossExponent: 2.2,
        wallLossDb: { drywall: 4, brick: 12, glass: 1 },
        floorLossDb: { 'timber-joist': 5.5 },
      },
    }
    const values: ModelValues = defaultValues('5GHz')
    values.exponent = 2.2
    values.wallLossDb.drywall = 4
    values.wallLossDb.brick = 12
    values.wallLossDb.glass = 1
    values.floorScale['timber-joist'] =
      5.5 / FLOOR_LOSS_DB['5GHz']['timber-joist']
    const expected = predictReadings(plan, calibration).filter(
      (r) => r.band === '5GHz',
    )
    const paths = surveyPaths(plan, '5GHz')
    // Some paths cross a slab and walls on both floors.
    expect(
      paths.some(
        (p) =>
          (p.slabLossDb['timber-joist'] ?? 0) > 0 && p.crossings.length > 1,
      ),
    ).toBe(true)
    paths.forEach((path, i) => {
      expect(predictPath(path, values)).toBeCloseTo(
        expected[i]!.predictedDbm,
        9,
      )
    })
  })

  it('leaves out slabs where the path passes through a stairwell', () => {
    // Straight above the downstairs router at (4, 3)? The stairwell is at
    // x 6–7, y 4–7 upstairs; a spot above it, from a router below it.
    const plan = twoStoreyHouse()
    const withRouter: Plan = {
      ...plan,
      accessPoints: [
        { ...plan.accessPoints[0]!, x: 6.5, y: 5.5 },
        plan.accessPoints[1]!,
      ],
      floors: plan.floors.map((floor) =>
        floor.id === 'up'
          ? {
              ...floor,
              surveySpots: [
                {
                  id: 'above',
                  x: 6.5,
                  y: 5.6,
                  readings: [
                    {
                      apId: plan.accessPoints[0]!.id,
                      band: '5GHz',
                      dbm: -50,
                    },
                  ],
                },
              ],
            }
          : floor,
      ),
    }
    const [path] = surveyPaths(withRouter, '5GHz')
    expect(path!.slabLossDb['timber-joist']).toBeUndefined()
  })
})

describe('surveyReadiness', () => {
  it('needs 10 spots, in at least half the rooms of each floor', () => {
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    const withSpots = (count: number): Plan => ({
      ...plan,
      floors: [{ ...floor, surveySpots: floor.surveySpots!.slice(0, count) }],
    })
    const nine = surveyReadiness(
      withSpots(9),
      surveyPaths(withSpots(9), '5GHz'),
    )
    expect(nine).toMatchObject({
      spots: 9,
      spotsNeeded: MIN_SPOTS,
      ready: false,
    })
    // 25 rooms of 12 m²: 13 needed. The first 10 spots cover 10 rooms.
    const ten = surveyReadiness(
      withSpots(10),
      surveyPaths(withSpots(10), '5GHz'),
    )
    expect(ten.floors).toHaveLength(1)
    expect(ten.floors[0]).toMatchObject({
      rooms: 25,
      roomsWithSpots: 10,
      roomsNeeded: 13,
    })
    expect(ten.floors[0]!.emptyRooms).toHaveLength(15)
    expect(ten.ready).toBe(false)
    const thirteen = surveyPaths(withSpots(13), '5GHz')
    expect(surveyReadiness(withSpots(13), thirteen).ready).toBe(true)
  })

  it('counts a room once however many spots it has', () => {
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    // Twelve spots, all in the first room.
    const spots = Array.from({ length: 12 }, (_, i) => ({
      ...floor.surveySpots![0]!,
      id: `same${i}`,
      x: 1 + i * 0.2,
    }))
    const crowded: Plan = {
      ...plan,
      floors: [{ ...floor, surveySpots: spots }],
    }
    const readiness = surveyReadiness(crowded, surveyPaths(crowded, '5GHz'))
    expect(readiness.spots).toBe(12)
    expect(readiness.floors[0]!.roomsWithSpots).toBe(1)
    expect(readiness.ready).toBe(false)
  })

  it('names each empty room by a point inside it', () => {
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    const one: Plan = {
      ...plan,
      floors: [{ ...floor, surveySpots: floor.surveySpots!.slice(0, 1) }],
    }
    const { emptyRooms } = surveyReadiness(one, surveyPaths(one, '5GHz'))
      .floors[0]!
    // Rooms of 4 × 3 m; the point is the room's middle cell, give or take one.
    for (const room of emptyRooms) {
      expect(room.areaM2).toBeGreaterThan(11)
      const col = Math.floor(room.x / 4)
      const row = Math.floor(room.y / 3)
      expect(Math.abs(room.x - (col + 0.5) * 4)).toBeLessThan(0.11)
      expect(Math.abs(room.y - (row + 0.5) * 3)).toBeLessThan(0.11)
    }
    expect(emptyRooms).toHaveLength(24)
  })

  it('needs spots on every floor with rooms', () => {
    const plan = surveyedTwoStorey()
    const downstairsOnly: Plan = {
      ...plan,
      floors: plan.floors.map((f, i) =>
        i === 0 ? f : { ...f, surveySpots: [] },
      ),
    }
    const readiness = surveyReadiness(
      downstairsOnly,
      surveyPaths(downstairsOnly, '5GHz'),
    )
    expect(readiness.spots).toBe(25)
    expect(readiness.floors.map((f) => f.roomsWithSpots)).toEqual([25, 0])
    expect(readiness.ready).toBe(false)
  })
})

describe('surveyReadiness: separate places and distances (D101)', () => {
  /** Two 5 × 6 m rooms, the access point in the right-hand one. */
  const twoRooms = (spots: [number, number, number][]): Plan => ({
    schemaVersion: 1,
    name: 'Two rooms',
    floors: [
      {
        ...room(10, 6, { x: 5, material: 'drywall' }),
        surveySpots: spots.map(([x, y, dbm], i) => ({
          id: `s${i}`,
          x,
          y,
          readings: [{ apId: 'ap-8-3', band: '5GHz', dbm }],
        })),
      },
    ],
    accessPoints: [ap(8, 3)],
  })

  it('counts ten spots at one place as one', () => {
    // The room rule alone passes: one of two rooms has spots.
    const plan = twoRooms(Array.from({ length: 10 }, () => [3, 3, -50]))
    const readiness = surveyReadiness(plan, surveyPaths(plan, '5GHz'))
    expect(readiness).toMatchObject({
      spots: 10,
      separateSpots: 1,
      spotsNeeded: MIN_SPOTS,
      ready: false,
    })
    expect(readiness.floors[0]).toMatchObject({
      rooms: 2,
      roomsWithSpots: 1,
      roomsNeeded: 1,
    })
    // Every reading at one distance: n and the offset can't be told apart.
    expect(readiness.distanceSpreadDb).toBeLessThan(1e-9)
    // So no fit: it used to stop n at its limit and claim 0.00 dB held out.
    expect(calibrateBand(plan, '5GHz').fit).toBeUndefined()
  })

  it('counts nine spots at one place and one elsewhere as two', () => {
    const plan = twoRooms([
      ...Array.from({ length: 9 }, (): [number, number, number] => [3, 3, -50]),
      [7, 5, -45],
    ])
    const readiness = surveyReadiness(plan, surveyPaths(plan, '5GHz'))
    expect(readiness).toMatchObject({
      spots: 10,
      separateSpots: 2,
      ready: false,
    })
    expect(calibrateBand(plan, '5GHz').fit).toBeUndefined()
  })

  it(`counts spots ${MIN_SPOT_SEPARATION_M} m apart separately, and closer ones as one`, () => {
    const row = (step: number) =>
      twoRooms(
        Array.from({ length: 10 }, (_, i): [number, number, number] => [
          0.5 + i * step,
          1,
          -50,
        ]),
      )
    const apart = row(MIN_SPOT_SEPARATION_M)
    expect(
      surveyReadiness(apart, surveyPaths(apart, '5GHz')).separateSpots,
    ).toBe(10)
    // 0.9 m steps: every other spot is within 1 m of one counted.
    const close = row(0.9)
    expect(
      surveyReadiness(close, surveyPaths(close, '5GHz')).separateSpots,
    ).toBe(5)
  })

  it('counts the same point on two floors as two places', () => {
    const plan = surveyedTwoStorey()
    const readiness = surveyReadiness(plan, surveyPaths(plan, '5GHz'))
    // Both floors have spots at the same x and y.
    expect(readiness.separateSpots).toBe(50)
  })

  it('needs readings at a spread of distances, not all at one', () => {
    // Ten spots 1.6 m apart on a circle 2.5 m around the access point, in
    // one open room: separate places, but all at the same distance.
    const plan: Plan = {
      schemaVersion: 1,
      name: 'Open',
      floors: [
        {
          ...room(10, 10),
          surveySpots: Array.from({ length: 10 }, (_, i) => ({
            id: `c${i}`,
            x: 5 + 2.5 * Math.cos((i * Math.PI) / 5),
            y: 5 + 2.5 * Math.sin((i * Math.PI) / 5),
            readings: [{ apId: 'ap-5-5', band: '5GHz' as Band, dbm: -50 }],
          })),
        },
      ],
      accessPoints: [ap(5, 5)],
    }
    const readiness = surveyReadiness(plan, surveyPaths(plan, '5GHz'))
    expect(readiness.separateSpots).toBe(10)
    expect(readiness.floors[0]!.roomsWithSpots).toBe(1)
    expect(readiness.distanceSpreadDb).toBeLessThan(1e-9)
    expect(readiness.distanceSpreadNeededDb).toBe(MIN_DISTANCE_SPREAD_DB)
    expect(readiness.ready).toBe(false)
  })

  it('still offers a fit for a survey with a spot in each room', () => {
    for (const plan of [surveyedBigHouse(), surveyedTwoStorey()]) {
      for (const band of ['2.4GHz', '5GHz', '6GHz'] as Band[]) {
        const readiness = surveyReadiness(plan, surveyPaths(plan, band))
        expect(readiness.separateSpots).toBe(readiness.spots)
        // 2.2–2.7 dB: well clear of the threshold.
        expect(readiness.distanceSpreadDb).toBeGreaterThan(2)
        expect(readiness.ready).toBe(true)
      }
    }
  })
})

describe('calibrateBand', () => {
  it('offers no fit until the survey is ready', () => {
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    const few: Plan = {
      ...plan,
      floors: [{ ...floor, surveySpots: floor.surveySpots!.slice(0, 5) }],
    }
    expect(calibrateBand(few, '5GHz').fit).toBeUndefined()
  })

  it('recovers known values exactly from readings without noise', () => {
    const truth: Calibration = {
      '5GHz': {
        pathLossExponent: 2.25,
        // Inside the limits; every spot is indoors, so no path crosses the
        // brick outside walls or their windows.
        wallLossDb: { drywall: 2.1, wood: 3 },
      },
    }
    const plan = simulate(surveyedBigHouse(), truth, -5, 0)
    const { fit } = calibrateBand(plan, '5GHz')
    expect(fit).toBeDefined()
    expect(fit!.exponent.value).toBeCloseTo(2.25, 6)
    expect(fit!.deviceOffsetDb.value).toBeCloseTo(-5, 5)
    const wall = (m: string) => fit!.walls.find((w) => w.material === m)!
    expect(wall('drywall').valueDb).toBeCloseTo(2.1, 5)
    expect(wall('wood').valueDb).toBeCloseTo(3, 5)
    expect(fit!.walls.map((w) => w.material)).toEqual(['drywall', 'wood'])
    expect(fit!.after.rmsDb).toBeLessThan(1e-4)
    // Without its offset, the fit is 5 dB too hopeful at every reading:
    // the offset belongs to the phone and isn't saved.
    expect(fit!.afterWithoutOffset.meanDb).toBeCloseTo(5, 4)
    expect(fit!.afterWithoutOffset.rmsDb).toBeCloseTo(5, 4)
    expect(fit!.calibration).not.toHaveProperty('offsetDb')
    // Before, the defaults are off by the offset and the materials.
    expect(fit!.before.rmsDb).toBeGreaterThan(3)
  })

  it('recovers known values within tolerance through 3 dB of noise', () => {
    // 25 spots and two access points: 50 readings. With noise, the exponent
    // trades off against the offset (both follow distance), so one survey
    // pins down the predictions far better than n alone. Over eight noisy
    // surveys the values average out close to the truth, and each fit
    // predicts the noise-free signal well within the noise.
    const truth: Calibration = {
      '5GHz': {
        pathLossExponent: 2.2,
        wallLossDb: { drywall: 1.2, wood: 5 },
      },
    }
    const exact = simulate(surveyedBigHouse(), truth, -6, 0)
    const exactPaths = surveyPaths(exact, '5GHz')
    const fits = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (seed) =>
        calibrateBand(simulate(surveyedBigHouse(), truth, -6, 3, seed), '5GHz')
          .fit!,
    )
    const mean = (values: number[]) =>
      values.reduce((s, v) => s + v, 0) / values.length
    const wall = (fit: (typeof fits)[number], m: string) =>
      fit.walls.find((w) => w.material === m)!.valueDb
    expect(
      Math.abs(mean(fits.map((f) => f.exponent.value)) - 2.2),
    ).toBeLessThan(0.1)
    expect(
      Math.abs(mean(fits.map((f) => f.deviceOffsetDb.value)) + 6),
    ).toBeLessThan(1)
    expect(
      Math.abs(mean(fits.map((f) => wall(f, 'drywall'))) - 1.2),
    ).toBeLessThan(0.3)
    expect(Math.abs(mean(fits.map((f) => wall(f, 'wood'))) - 5)).toBeLessThan(1)
    const predictionRms: number[] = []
    for (const fit of fits) {
      const values = defaultValues('5GHz')
      values.exponent = fit.exponent.value
      values.offsetDb = fit.deviceOffsetDb.value
      for (const w of fit.walls) values.wallLossDb[w.material] = w.valueDb
      const errors = exactPaths.map(
        (p) => predictPath(p, values) - p.measuredDbm,
      )
      const rms = Math.sqrt(mean(errors.map((e) => e * e)))
      // 0.5–1.8 dB here: always well under the noise.
      expect(rms).toBeLessThan(2)
      predictionRms.push(rms)
      // Held out, the fit beats the defaults and is near the noise.
      expect(fit.after.rmsDb).toBeLessThan(fit.before.rmsDb / 2)
      expect(fit.after.rmsDb).toBeLessThan(3.6)
    }
    expect(mean(predictionRms)).toBeLessThan(1.2)
  })

  it('fits a floor from readings on both storeys', () => {
    const headOn = 5
    const truth: Calibration = {
      '5GHz': {
        pathLossExponent: 2.1,
        wallLossDb: { drywall: 2 },
        floorLossDb: { 'timber-joist': headOn },
      },
    }
    const plan = simulate(surveyedTwoStorey(), truth, -4, 1, 3)
    const { fit } = calibrateBand(plan, '5GHz')
    const timber = fit!.floors.find((f) => f.material === 'timber-joist')!
    expect(timber.kept).toBeUndefined()
    expect(timber.limitsDb).toEqual(floorLimitsDb('5GHz', 'timber-joist'))
    expect(Math.abs(timber.valueDb - headOn)).toBeLessThan(0.5)
    expect(fit!.calibration.floorLossDb!['timber-joist']).toBeCloseTo(
      timber.valueDb,
      9,
    )
    expect(Math.abs(fit!.exponent.value - 2.1)).toBeLessThan(0.2)
  })

  it('refits when the lossiest material at a shared crossing changes', () => {
    // A spot whose path from AP 1 at (5, 4) passes exactly through the edge
    // of a door, at (4, 3.6), where the drywall wall and the wood door meet.
    // By default drywall is lossier there; in truth wood is.
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    const edge = { ...floor.surveySpots![0]!, id: 'edge', x: 2, y: 2.8 }
    const surveyed: Plan = {
      ...plan,
      floors: [{ ...floor, surveySpots: [...floor.surveySpots!, edge] }],
    }
    const path = surveyPaths(surveyed, '5GHz').find(
      (p) => p.spotId === 'edge' && p.apId === plan.accessPoints[0]!.id,
    )!
    expect(path.crossings.some((c) => c.length === 2)).toBe(true)
    const truth: Calibration = {
      '5GHz': { pathLossExponent: 2.1, wallLossDb: { drywall: 2, wood: 5 } },
    }
    const { fit } = calibrateBand(simulate(surveyed, truth, -3, 0), '5GHz')
    expect(fit!.exponent.value).toBeCloseTo(2.1, 6)
    const wall = (m: string) => fit!.walls.find((w) => w.material === m)!
    expect(wall('drywall').valueDb).toBeCloseTo(2, 5)
    expect(wall('wood').valueDb).toBeCloseTo(5, 5)
    expect(fit!.after.rmsDb).toBeLessThan(1e-4)
  })

  it('stops at a limit and says so', () => {
    // Walls far lossier than any measurement, and a phone reading 40 dB low.
    const plan = simulate(
      surveyedBigHouse(),
      { '5GHz': { wallLossDb: { drywall: 9 } } },
      -40,
      0,
    )
    const { fit } = calibrateBand(plan, '5GHz')
    const drywall = fit!.walls.find((w) => w.material === 'drywall')!
    expect(drywall.valueDb).toBeCloseTo(wallLimitsDb('5GHz', 'drywall')![1], 6)
    expect(drywall.atLimit).toBe(true)
    expect(fit!.deviceOffsetDb.value).toBe(DEVICE_OFFSET_LIMITS_DB[0])
    expect(fit!.deviceOffsetDb.atLimit).toBe(true)
    expect(fit!.exponent.limits).toEqual(EXPONENT_LIMITS)
  })

  it('keeps a material crossed by too few paths at its default', () => {
    // Two spots in the garden: two of their four readings cross the brick
    // outside wall (the others pass through windows), short of 5 readings
    // from 3 spots.
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    const outside = [
      { id: 'garden1', x: 21, y: 4.3 },
      { id: 'garden2', x: 10.3, y: -1 },
    ].map((p) => ({ ...floor.surveySpots![0]!, ...p }))
    const simulated = simulate(
      {
        ...plan,
        floors: [
          { ...floor, surveySpots: [...floor.surveySpots!, ...outside] },
        ],
      },
      {},
      0,
      0,
    )
    const { fit } = calibrateBand(simulated, '5GHz')
    const brick = fit!.walls.find((w) => w.material === 'brick')!
    expect(brick).toMatchObject({
      readings: 2,
      spots: 2,
      kept: 'too-few-paths',
      valueDb: MATERIAL_LOSS_DB['5GHz'].brick,
      atLimit: false,
    })
    expect(brick.limitsDb).toEqual(wallLimitsDb('5GHz', 'brick'))
    expect(fit!.calibration.wallLossDb?.brick).toBeUndefined()
    expect(fit!.calibration.wallLossDb?.drywall).toBeDefined()
  })

  it('never fits a material with fewer than two measurements', () => {
    const plan = surveyedBigHouse()
    const floor = plan.floors[0]!
    // Every inside wall steel: crossed by nearly every path.
    const walls = floor.walls.map((w) =>
      w.material === 'drywall' ? { ...w, material: 'metal' as const } : w,
    )
    const simulated = simulate(
      { ...plan, floors: [{ ...floor, walls }] },
      {},
      0,
      0,
    )
    const { fit } = calibrateBand(simulated, '6GHz')
    const metal = fit!.walls.find((w) => w.material === 'metal')!
    expect(metal.readings).toBeGreaterThan(20)
    expect(metal.kept).toBe('no-limits')
    expect(metal.limitsDb).toBeUndefined()
    expect(metal.valueDb).toBe(MATERIAL_LOSS_DB['6GHz'].metal)
  })

  it('holds out each spot: before is the error report, after a fit without it', () => {
    const plan = simulate(
      surveyedBigHouse(),
      { '5GHz': { pathLossExponent: 2.3 } },
      -3,
      2,
      9,
    )
    const { fit } = calibrateBand(plan, '5GHz')
    const report = predictReadings(plan).filter((r) => r.band === '5GHz')
    expect(fit!.heldOut).toHaveLength(report.length)
    fit!.heldOut.forEach((reading, i) => {
      expect(reading.spotId).toBe(report[i]!.spotId)
      expect(reading.beforeDb).toBeCloseTo(report[i]!.errorDb, 9)
    })
    expect(fit!.before.count).toBe(report.length)
    // In-sample the fit can only be closer; held out it's a little further.
    const values = defaultValues('5GHz')
    values.exponent = fit!.exponent.value
    values.offsetDb = fit!.deviceOffsetDb.value
    for (const w of fit!.walls) values.wallLossDb[w.material] = w.valueDb
    const inSample = surveyPaths(plan, '5GHz').map(
      (p) => predictPath(p, values) - p.measuredDbm,
    )
    const inSampleRms = Math.sqrt(
      inSample.reduce((s, e) => s + e * e, 0) / inSample.length,
    )
    expect(fit!.after.rmsDb).toBeGreaterThan(inSampleRms)
  })
})
