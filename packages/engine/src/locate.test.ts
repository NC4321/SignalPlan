import type { Band, Plan, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { locateTransmitter, type LocateReading } from './locate.ts'
import { predictReadings } from './survey.ts'
import { bigHouse, gaussian, roomSpots, twoStoreyHouse } from './testPlans.ts'

interface Truth {
  floorId: string
  x: number
  y: number
  eirpDbm: number
}

/**
 * What a phone would read at each spot from a transmitter at `truth`, 1 m
 * above its floor like a new access point: the model's prediction
 * (`predictReadings`, so the fit is checked against the same model), plus
 * Gaussian noise of `sigmaDb`.
 */
function readingsFrom(
  plan: Plan,
  truth: Truth,
  spots: { floorId: string; spots: SurveySpot[] }[],
  band: Band = '5GHz',
  sigmaDb = 0,
  seed = 1,
): LocateReading[] {
  const noise = gaussian(seed)
  const withSource: Plan = {
    ...plan,
    accessPoints: [
      {
        id: 't',
        name: 'Truth',
        floorId: truth.floorId,
        x: truth.x,
        y: truth.y,
        heightM: 1,
        radios: [{ band, txPowerDbm: truth.eirpDbm }],
      },
    ],
    floors: plan.floors.map((floor) => ({
      ...floor,
      surveySpots: (spots.find((s) => s.floorId === floor.id)?.spots ?? []).map(
        (spot) => ({
          ...spot,
          readings: [{ apId: 't', band, dbm: -60 }],
        }),
      ),
    })),
  }
  const spotAt = new Map(
    withSource.floors.flatMap((f) =>
      (f.surveySpots ?? []).map((s) => [s.id, s] as const),
    ),
  )
  return predictReadings(withSource).map((r) => ({
    floorId: r.floorId,
    x: spotAt.get(r.spotId)!.x,
    y: spotAt.get(r.spotId)!.y,
    dbm: r.predictedDbm + sigmaDb * noise(),
  }))
}

const house = bigHouse()
const floorId = house.floors[0]!.id
const houseSpots = [{ floorId, spots: roomSpots(house, 4, 3) }]

describe('locateTransmitter (D83)', () => {
  it('recovers an access point inside the home exactly without noise', () => {
    const truth = { floorId, x: 9.3, y: 7.6, eirpDbm: 20 }
    const found = locateTransmitter(
      house,
      '5GHz',
      readingsFrom(house, truth, houseSpots),
    )!
    expect(found.floorId).toBe(floorId)
    expect(found.x).toBeCloseTo(truth.x, 1)
    expect(found.y).toBeCloseTo(truth.y, 1)
    expect(found.eirpDbm).toBeCloseTo(truth.eirpDbm, 1)
    expect(found.rmsDb).toBeLessThan(0.1)
    expect(found.uncertaintyM).toBeLessThan(0.2)
    expect(found.outside).toBe(false)
    expect(found.atSearchEdge).toBe(false)
  })

  it('places a neighbour outside the walls', () => {
    const truth = { floorId, x: -6.2, y: 5.3, eirpDbm: 18 }
    const found = locateTransmitter(
      house,
      '2.4GHz',
      readingsFrom(house, truth, houseSpots, '2.4GHz'),
    )!
    expect(found.x).toBeCloseTo(truth.x, 1)
    expect(found.y).toBeCloseTo(truth.y, 1)
    expect(found.outside).toBe(true)
    expect(found.nearestWallM).toBeCloseTo(6.2, 1)
  })

  it('finds the floor in a two-storey house', () => {
    const plan = twoStoreyHouse()
    const spots = plan.floors.map((floor, i) => ({
      floorId: floor.id,
      spots: roomSpots(plan, 3, 2, `f${i}-`),
    }))
    const truth = { floorId: 'up', x: 3.4, y: 8.2, eirpDbm: 20 }
    const found = locateTransmitter(
      plan,
      '5GHz',
      readingsFrom(plan, truth, spots),
    )!
    expect(found.floorId).toBe('up')
    expect(found.x).toBeCloseTo(truth.x, 1)
    expect(found.y).toBeCloseTo(truth.y, 1)
    expect(found.floorIds[0]).toBe('up')
  })

  it('takes the phone’s offset off the power, as the error report does', () => {
    const truth = { floorId, x: 9.3, y: 7.6, eirpDbm: 20 }
    const readings = readingsFrom(house, truth, houseSpots).map((r) => ({
      ...r,
      dbm: r.dbm - 5,
    }))
    const found = locateTransmitter(house, '5GHz', readings, {
      calibration: { deviceOffsetDb: -5 },
    })!
    expect(found.eirpDbm).toBeCloseTo(20, 1)
  })

  it('is within its uncertainty with 3 dB of noise, in at least 19 of 20 surveys', () => {
    const truth = { floorId, x: 9.3, y: 7.6, eirpDbm: 20 }
    let within = 0
    for (let seed = 1; seed <= 20; seed++) {
      const found = locateTransmitter(
        house,
        '5GHz',
        readingsFrom(house, truth, houseSpots, '5GHz', 3, seed),
      )!
      const off = Math.hypot(found.x - truth.x, found.y - truth.y)
      expect(found.uncertaintyM).toBeLessThan(10)
      if (found.floorId === floorId && off <= found.uncertaintyM) within++
    }
    expect(within).toBeGreaterThanOrEqual(19)
  })

  it('needs three spots, and with only three says nothing of its uncertainty unless told the model’s error', () => {
    const truth = { floorId, x: 9.3, y: 7.6, eirpDbm: 20 }
    const all = readingsFrom(house, truth, houseSpots)
    expect(locateTransmitter(house, '5GHz', all.slice(0, 2))).toBeUndefined()
    const three = [all[0]!, all[12]!, all[24]!]
    expect(locateTransmitter(house, '5GHz', three)!.uncertaintyM).toBe(
      Number.POSITIVE_INFINITY,
    )
    const told = locateTransmitter(house, '5GHz', three, { modelErrorDb: 3 })!
    expect(Number.isFinite(told.uncertaintyM)).toBe(true)
  })

  it('holds the power at the highest a radio can be set to', () => {
    // Far beyond the search area: the fit wants more power than allowed.
    const truth = { floorId, x: -60, y: 7, eirpDbm: 40 }
    const found = locateTransmitter(
      house,
      '5GHz',
      readingsFrom(house, truth, houseSpots),
    )!
    expect(found.eirpDbm).toBeLessThanOrEqual(40)
    expect(found.atSearchEdge).toBe(true)
  })
})
