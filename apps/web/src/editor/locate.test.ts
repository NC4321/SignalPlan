import { predictReadings } from '@signalplan/engine'
import { parsePlan, type Plan } from '@signalplan/floorplan'
import surveyedHome from '@signalplan/floorplan/fixtures/surveyed-home.json'
import { describe, expect, it } from 'vitest'
import {
  checkBand,
  checkPosition,
  describeNeighbourLocation,
  describePositionCheck,
  describeUnplacedCheck,
  describeUnplacedNeighbour,
  formatRadius,
  locateNeighbour,
  neighbourBssids,
  neighbourSpotCount,
  outsideFloor,
  toNeighbourLocation,
  tryCheckPosition,
  tryLocateNeighbour,
} from './locate.ts'
import { createEditorStore } from './store.ts'

function surveyed(): Plan {
  const result = parsePlan(surveyedHome)
  if (!result.ok) throw new Error('fixture is invalid')
  return result.plan
}

const router = (plan: Plan) => plan.accessPoints[0]!

/**
 * The surveyed bungalow with a neighbour's 5 GHz network next door, at
 * (−4, 4) and 18 dBm: each spot hears two of its BSSIDs, which look like
 * one device, at the model's own prediction.
 */
function withNeighbour(spots = Infinity): Plan {
  const plan = surveyed()
  const floorId = plan.floors[0]!.id
  const standIn = {
    id: 'next-door',
    name: 'Next door',
    floorId,
    x: -4,
    y: 4,
    heightM: 1,
    radios: [{ band: '5GHz' as const, txPowerDbm: 18 }],
  }
  const probe: Plan = {
    ...plan,
    accessPoints: [standIn],
    floors: plan.floors.map((f) => ({
      ...f,
      surveySpots: f.surveySpots?.map((s) => ({
        ...s,
        readings: [{ apId: 'next-door', band: '5GHz' as const, dbm: -60 }],
      })),
    })),
  }
  const heard = new Map(predictReadings(probe).map((r) => [r.spotId, r]))
  return {
    ...plan,
    neighbourNetworks: [
      {
        id: 'nn1',
        name: 'Smith',
        band: '5GHz',
        channel: 36,
        channelWidthMHz: 20,
        strengthDbm: -60,
        bssid: '02:aa:bb:cc:dd:10',
      },
    ],
    floors: plan.floors.map((f) => ({
      ...f,
      surveySpots: f.surveySpots?.map((s, i) => {
        const dbm = Math.round(heard.get(s.id)!.predictedDbm * 10) / 10
        return i < spots
          ? {
              ...s,
              neighbourReadings: [
                { bssid: '02:aa:bb:cc:dd:10', band: '5GHz' as const, dbm },
                // The same device's guest network, without the locally
                // administered bit.
                { bssid: '00:aa:bb:cc:dd:11', band: '5GHz' as const, dbm },
                // Someone else's.
                { bssid: '02:99:99:99:99:99', band: '5GHz' as const, dbm: -40 },
              ],
            }
          : s
      }),
    })),
  }
}

/**
 * An empty 10 m square room with three spots, where a neighbour's network
 * and the room's own access point are each heard at −95 dBm: faintly and
 * the same everywhere, as a far-off neighbour is.
 */
function faintRoom(): Plan {
  const corners = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]
  const result = parsePlan({
    schemaVersion: 1,
    name: 'Room',
    floors: [
      {
        id: 'f',
        name: 'Floor',
        elevationM: 0,
        heightM: 2.5,
        nodes: corners.map(([x, y], i) => ({ id: `n${i}`, x, y })),
        walls: corners.map((_, i) => ({
          id: `w${i}`,
          from: `n${i}`,
          to: `n${(i + 1) % 4}`,
          material: 'drywall',
        })),
        openings: [],
        surveySpots: [
          [2, 2],
          [8, 2],
          [5, 8],
        ].map(([x, y], i) => ({
          id: `s${i}`,
          x,
          y,
          readings: [{ apId: 'ap', band: '5GHz', dbm: -95 }],
          neighbourReadings: [
            { bssid: '02:aa:bb:cc:dd:10', band: '5GHz', dbm: -95 },
          ],
        })),
      },
    ],
    accessPoints: [
      {
        id: 'ap',
        name: 'Router',
        floorId: 'f',
        x: 5,
        y: 5,
        heightM: 1,
        radios: [{ band: '5GHz' }],
      },
    ],
    neighbourNetworks: [
      {
        id: 'nn1',
        name: 'Smith',
        band: '5GHz',
        channel: 36,
        channelWidthMHz: 20,
        strengthDbm: -95,
        bssid: '02:aa:bb:cc:dd:10',
      },
    ],
  })
  if (!result.ok) throw new Error('invalid')
  return result.plan
}

describe('locating a neighbour (D85)', () => {
  it('takes the BSSIDs that look like the network’s device', () => {
    const plan = withNeighbour()
    const network = plan.neighbourNetworks![0]!
    expect(neighbourBssids(plan, network).sort()).toEqual([
      '00:aa:bb:cc:dd:11',
      '02:aa:bb:cc:dd:10',
    ])
    expect(neighbourSpotCount(plan, network)).toBe(11)
    expect(neighbourBssids(plan, { ...network, bssid: undefined })).toEqual([])
  })

  it('needs scans at three spots', () => {
    const plan = withNeighbour(2)
    const network = plan.neighbourNetworks![0]!
    expect(neighbourSpotCount(plan, network)).toBe(2)
    expect(locateNeighbour(plan, network)).toBeUndefined()
  })

  it('locates it outside the walls and says so, no more precisely than its radius', () => {
    const plan = withNeighbour()
    const found = locateNeighbour(plan, plan.neighbourNetworks![0]!)!
    expect(Math.hypot(found.x + 4, found.y - 4)).toBeLessThan(0.05)
    expect(found.eirpDbm).toBeCloseTo(18, 0)
    const location = toNeighbourLocation(found)
    expect(location.x).toBe(Math.round(found.x * 100) / 100)
    expect(outsideFloor(plan, location)).toBe(true)
    const text = describeNeighbourLocation(plan, location, 'metric')
    expect(text).toContain('Located, outside the walls, to within ')
    expect(text).toContain(formatRadius(location.uncertaintyM, 'metric'))
    expect(text).toContain('sending about 18 dBm')
  })

  it('says plainly when it’s heard too weakly to place (D103)', () => {
    const plan = faintRoom()
    const network = plan.neighbourNetworks![0]!
    expect(tryLocateNeighbour(plan, network)).toEqual({ unplaced: 'too-weak' })
    expect(locateNeighbour(plan, network)).toBeUndefined()
    expect(describeUnplacedNeighbour('too-weak', false, 'metric')).toBe(
      'heard too weakly to place. It’s probably more than 10 m past the walls. It still counts at one strength everywhere.',
    )
    expect(describeUnplacedNeighbour('too-far', true, 'imperial')).toBe(
      'heard too weakly to place. It’s probably more than 33 ft past the walls. Its last location is kept.',
    )
    expect(describeUnplacedNeighbour('too-strong', false, 'metric')).toMatch(
      /^heard too strongly to place\. No spot within 10 m of the walls fits its scans\./,
    )
  })

  it('rounds the radius up to whole metres or feet', () => {
    expect(formatRadius(0.2, 'metric')).toBe('1 m')
    expect(formatRadius(2.01, 'metric')).toBe('3 m')
    expect(formatRadius(3, 'imperial')).toBe('10 ft')
    expect(formatRadius(3.1, 'imperial')).toBe('11 ft')
  })
})

describe('checking an access point’s position (D85)', () => {
  it('agrees where the router is, and finds it when it has been moved', () => {
    const plan = surveyed()
    const ap = router(plan)
    expect(checkBand(plan, ap.id)).toBe('2.4GHz')
    const here = checkPosition(plan, ap.id)!
    const agrees = describePositionCheck(plan, here, 'metric')
    expect(agrees.agrees).toBe(true)
    expect(agrees.text).toMatch(/^The readings agree with where it is/)

    const moved: Plan = {
      ...plan,
      accessPoints: [{ ...ap, x: ap.x + 7, y: ap.y + 2 }],
    }
    const check = checkPosition(moved, ap.id)!
    expect(
      Math.hypot(check.location.x - ap.x, check.location.y - ap.y),
    ).toBeLessThan(check.location.uncertaintyM)
    const { text, agrees: ok } = describePositionCheck(moved, check, 'metric')
    expect(ok).toBe(false)
    expect(text).toMatch(
      /^The readings put it about \d+ m from here, to within \d+ m\./,
    )
  })

  it('has nothing to check without readings at three spots', () => {
    const plan = surveyed()
    const bare: Plan = {
      ...plan,
      floors: plan.floors.map((f) => ({
        ...f,
        surveySpots: f.surveySpots?.slice(0, 2),
      })),
    }
    expect(checkBand(bare, router(bare).id)).toBeUndefined()
    expect(checkPosition(bare, router(bare).id)).toBeUndefined()
  })

  it('previews, applies as one edit, and drops on any change', () => {
    const plan = surveyed()
    const ap = router(plan)
    const store = createEditorStore({
      ...plan,
      accessPoints: [{ ...ap, x: ap.x + 7, y: ap.y + 2 }],
    })
    store.getState().checkPosition(ap.id)
    const check = store.getState().positionCheck!
    expect(check.apId).toBe(ap.id)
    store.getState().applyPositionCheck()
    const after = store.getState().plan.accessPoints[0]!
    expect(after.x).toBeCloseTo(check.location.x, 2)
    expect(after.y).toBeCloseTo(check.location.y, 2)
    expect(store.getState().positionCheck).toBeUndefined()
    expect(store.getState().past.at(-1)!.label).toBe(
      'Move access point to its readings',
    )
    store.getState().undo()
    expect(store.getState().plan.accessPoints[0]!.x).toBe(ap.x + 7)

    store.getState().checkPosition(ap.id)
    store.getState().edit('Rename', (p) => {
      p.name = 'Renamed'
    })
    expect(store.getState().positionCheck).toBeUndefined()
    expect(store.getState().notice).toBe(
      'Position check dismissed: the plan changed.',
    )
  })

  it('leaves a locked access point where it is', () => {
    const plan = surveyed()
    const ap = router(plan)
    const store = createEditorStore({
      ...plan,
      accessPoints: [{ ...ap, x: ap.x + 7, locked: true }],
    })
    store.getState().checkPosition(ap.id)
    store.getState().applyPositionCheck()
    expect(store.getState().plan.accessPoints[0]!.x).toBe(ap.x + 7)
  })

  it('says when its readings are too weak to place it (D103)', () => {
    const plan = faintRoom()
    const ap = router(plan)
    expect(tryCheckPosition(plan, ap.id)).toBe('too-weak')
    expect(checkPosition(plan, ap.id)).toBeUndefined()
    const store = createEditorStore(plan)
    store.getState().checkPosition(ap.id)
    expect(store.getState().positionCheck).toBeUndefined()
    expect(store.getState().notice).toBe(describeUnplacedCheck('too-weak'))
    expect(store.getState().notice).toMatch(
      /^Its readings are heard too weakly to place it anywhere inside the walls/,
    )
  })

  it('says when there are too few readings', () => {
    const plan = surveyed()
    const store = createEditorStore({
      ...plan,
      floors: plan.floors.map((f) => ({ ...f, surveySpots: [] })),
    })
    store.getState().checkPosition(router(plan).id)
    expect(store.getState().positionCheck).toBeUndefined()
    expect(store.getState().notice).toMatch(/too few/)
  })
})
