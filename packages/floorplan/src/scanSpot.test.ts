import { describe, expect, it } from 'vitest'
import sampleHome from '../fixtures/sample-home.json' with { type: 'json' }
import {
  applyScan,
  planScan,
  type ScanChoice,
  type ScanTuning,
} from './scanApply.ts'
import type { ScanEntry } from './scanImport.ts'
import { addScanToMean, applyScanAtSpot, type ScanPlace } from './scanSpot.ts'
import type { Band, Plan } from './schema.ts'
import { addSurveySpot, setReadingDbm } from './survey.ts'
import { meanPowerDbm } from './surveyImport.ts'
import { parsePlan } from './validate.ts'

function sample(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) throw new Error('sample-home.json is invalid')
  return result.plan
}

const tuning: ScanTuning = {
  usualWidth: (band: Band) => (band === '2.4GHz' ? 20 : 80),
  channelAt: (_band, primary, width) => (width === 20 ? primary : undefined),
}

const entry = (
  bssid: string,
  band: Band,
  dbm: number,
  more: Partial<ScanEntry> = {},
): ScanEntry => ({ where: '', bssid, band, dbm, approximate: false, ...more })

const HOME_5 = entry('a4:2b:b0:12:34:56', '5GHz', -50, { ssid: 'HomeNet' })
const HOME_5_GUEST = entry('a6:2b:b0:12:34:56', '5GHz', -56, {
  ssid: 'HomeNet-Guest',
})
const HOME_24 = entry('a4:2b:b0:12:34:55', '2.4GHz', -45, { ssid: 'HomeNet' })
const NEXT_5 = entry('10:20:30:40:50:60', '5GHz', -84, {
  ssid: 'Next door',
  channel: 149,
})
const NEXT_5_GUEST = entry('12:20:30:40:50:61', '5GHz', -80, {
  ssid: 'Next door guest',
  channel: 149,
})
const FAR = entry('20:20:30:40:50:60', '5GHz', -90, { ssid: 'Far away' })

const choices = (pairs: [ScanEntry, ScanChoice][]) =>
  new Map(pairs.map(([e, c]) => [e.bssid, c]))

const ANSWERS = choices([
  [HOME_5, { apId: 'router' }],
  [HOME_5_GUEST, { apId: 'router' }],
  [HOME_24, { apId: 'router' }],
  [NEXT_5, 'neighbour'],
  [NEXT_5_GUEST, 'neighbour'],
  [FAR, 'ignore'],
])

/** Applies a scan at a place as the dialog does, in one go. */
function scanAt(
  plan: Plan,
  entries: ScanEntry[],
  place: ScanPlace,
  answers = ANSWERS,
) {
  const changes = planScan(plan, entries, answers, tuning)
  applyScan(plan, changes)
  return applyScanAtSpot(plan, entries, changes, place)
}

const spots = (plan: Plan) => plan.floors[0]!.surveySpots ?? []

describe('addScanToMean (D82)', () => {
  it('weights the earlier mean by its number of scans', () => {
    expect(addScanToMean(-50, 1, -60)).toBe(meanPowerDbm([-50, -60]))
    expect(addScanToMean(meanPowerDbm([-50, -60]), 2, -70)).toBe(
      meanPowerDbm([-50, -60, -70]),
    )
  })
})

describe('applyScanAtSpot (D82)', () => {
  it('adds a spot at a point, with a reading per radio at mean power', () => {
    const plan = sample()
    const summary = scanAt(plan, [HOME_5, HOME_5_GUEST, HOME_24, FAR], {
      floorId: 'main',
      x: 3,
      y: 4,
    })
    expect(summary).toMatchObject({
      spotAdded: true,
      readingsAdded: 2,
      readingsAveraged: 0,
    })
    const [spot] = spots(plan)
    expect(spot).toMatchObject({ id: summary.spotId, x: 3, y: 4 })
    expect(spot!.readings).toEqual([
      { apId: 'router', band: '5GHz', dbm: meanPowerDbm([-50, -56]) },
      { apId: 'router', band: '2.4GHz', dbm: -45 },
    ])
    expect(spot!.neighbourReadings).toBeUndefined()
    expect(parsePlan(plan).ok).toBe(true)
  })

  it('averages scans at one spot by power, keeping count, and marks approximate ones', () => {
    const plan = sample()
    const spotId = addSurveySpot(plan, 'main', { x: 1, y: 1 })
    scanAt(plan, [HOME_24], { spotId })
    scanAt(plan, [{ ...HOME_24, dbm: -55 }], { spotId })
    const summary = scanAt(
      plan,
      [{ ...HOME_24, dbm: -65, approximate: true }],
      {
        spotId,
      },
    )
    expect(summary).toMatchObject({ readingsAdded: 0, readingsAveraged: 1 })
    expect(spots(plan)[0]!.readings).toEqual([
      {
        apId: 'router',
        band: '2.4GHz',
        dbm: meanPowerDbm([-45, -55, -65]),
        approximate: true,
        scans: 3,
      },
    ])
    expect(parsePlan(plan).ok).toBe(true)
  })

  it('counts a typed reading as one scan, and typing a value clears the scan count', () => {
    const plan = sample()
    const spotId = addSurveySpot(plan, 'main', { x: 1, y: 1 })
    spots(plan)[0]!.readings.push({ apId: 'router', band: '2.4GHz', dbm: -60 })
    scanAt(plan, [HOME_24], { spotId })
    const reading = spots(plan)[0]!.readings[0]!
    expect(reading).toMatchObject({ dbm: meanPowerDbm([-60, -45]), scans: 2 })
    setReadingDbm(plan, spotId, 0, -52)
    expect(spots(plan)[0]!.readings[0]).toEqual({
      apId: 'router',
      band: '2.4GHz',
      dbm: -52,
    })
  })

  it('adds a reading on a band the access point has off, as D71 flags it', () => {
    const plan = sample()
    plan.accessPoints[0]!.radios = plan.accessPoints[0]!.radios.filter(
      (r) => r.band !== '6GHz',
    )
    const SIX = entry('a4:2b:b0:12:34:57', '6GHz', -62)
    scanAt(
      plan,
      [SIX],
      { floorId: 'main', x: 2, y: 2 },
      choices([[SIX, { apId: 'router' }]]),
    )
    expect(spots(plan)[0]!.readings).toEqual([
      { apId: 'router', band: '6GHz', dbm: -62 },
    ])
  })

  it('keeps neighbours heard at the spot, and sets their strength from the strongest spot', () => {
    const plan = sample()
    const a = addSurveySpot(plan, 'main', { x: 1, y: 1 })
    const b = addSurveySpot(plan, 'main', { x: 8, y: 1 })
    scanAt(plan, [NEXT_5, NEXT_5_GUEST], { spotId: a })
    expect(plan.neighbourNetworks).toHaveLength(1)
    expect(plan.neighbourNetworks![0]!.strengthDbm).toBe(-80)
    expect(spots(plan)[0]!.neighbourReadings).toEqual([
      { bssid: NEXT_5.bssid, band: '5GHz', dbm: -84 },
      { bssid: NEXT_5_GUEST.bssid, band: '5GHz', dbm: -80 },
    ])

    // Weaker at the second spot: the strength stays the strongest anywhere.
    const summary = scanAt(
      plan,
      [
        { ...NEXT_5, dbm: -90 },
        { ...NEXT_5_GUEST, dbm: -88 },
      ],
      { spotId: b },
    )
    expect(summary.neighboursHeard).toBe(1)
    expect(plan.neighbourNetworks![0]!.strengthDbm).toBe(-80)

    // Stronger at a third, new spot: it follows.
    scanAt(plan, [{ ...NEXT_5, dbm: -71.6 }], { floorId: 'main', x: 5, y: 5 })
    expect(plan.neighbourNetworks![0]!.strengthDbm).toBe(-72)
    expect(parsePlan(plan).ok).toBe(true)
  })

  it('averages a neighbour heard again at the same spot', () => {
    const plan = sample()
    const spotId = addSurveySpot(plan, 'main', { x: 1, y: 1 })
    scanAt(plan, [NEXT_5], { spotId })
    scanAt(plan, [{ ...NEXT_5, dbm: -74 }], { spotId })
    expect(spots(plan)[0]!.neighbourReadings).toEqual([
      {
        bssid: NEXT_5.bssid,
        band: '5GHz',
        dbm: meanPowerDbm([-84, -74]),
        scans: 2,
      },
    ])
    expect(plan.neighbourNetworks![0]!.strengthDbm).toBe(
      Math.round(meanPowerDbm([-84, -74])),
    )
  })
})

describe('validation (D82)', () => {
  it('refuses a BSSID heard twice at one spot', () => {
    const plan = sample()
    addSurveySpot(plan, 'main', { x: 1, y: 1 })
    spots(plan)[0]!.neighbourReadings = [
      { bssid: NEXT_5.bssid, band: '5GHz', dbm: -80 },
      { bssid: NEXT_5.bssid, band: '5GHz', dbm: -81 },
    ]
    const result = parsePlan(plan)
    expect(result.ok).toBe(false)
  })
})
