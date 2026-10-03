import { describe, expect, it } from 'vitest'
import sampleHome from '../fixtures/sample-home.json' with { type: 'json' }
import {
  applyScan,
  planScan,
  radioKey,
  unknownScanEntries,
  type ScanChoice,
  type ScanTuning,
} from './scanApply.ts'
import type { ScanEntry } from './scanImport.ts'
import type { Band, ChannelWidth, Plan } from './schema.ts'
import { parsePlan } from './validate.ts'

/** A changed copy of a plan, as the editor's Immer drafts make. */
function produce(plan: Plan, change: (draft: Plan) => void): Plan {
  const copy = JSON.parse(JSON.stringify(plan)) as Plan
  change(copy)
  return copy
}

function sample(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) throw new Error('sample-home.json is invalid')
  return result.plan
}

/** US-like rules for the tests: 80 MHz on 5 GHz, centre = primary + 6 for 36–48. */
const tuning: ScanTuning = {
  usualWidth: (band: Band): ChannelWidth => (band === '2.4GHz' ? 20 : 80),
  channelAt: (band, primary, width) => {
    if (width === 20) return primary
    if (band === '5GHz' && width === 80) {
      if (primary >= 36 && primary <= 48) return 42
      if (primary >= 149 && primary <= 161) return 155
    }
    return undefined
  },
}

const entry = (
  bssid: string,
  band: Band,
  dbm: number,
  more: Partial<ScanEntry> = {},
): ScanEntry => ({ where: '', bssid, band, dbm, approximate: false, ...more })

const HOME_5 = entry('a4:2b:b0:12:34:56', '5GHz', -50, {
  ssid: 'HomeNet',
  channel: 36,
  widthMHz: 80,
})
const HOME_5_GUEST = entry('a6:2b:b0:12:34:56', '5GHz', -51, {
  ssid: 'HomeNet-Guest',
  channel: 36,
  widthMHz: 80,
})
const HOME_24 = entry('a4:2b:b0:12:34:55', '2.4GHz', -45, {
  ssid: 'HomeNet',
  channel: 6,
})
const NEXT_5 = entry('10:20:30:40:50:60', '5GHz', -84.4, {
  ssid: 'Next door',
  channel: 149,
})
const NEXT_24 = entry('10:20:30:40:50:61', '2.4GHz', -78, {
  ssid: 'Next door',
  channel: 1,
  widthMHz: 20,
})
const FAR = entry('20:20:30:40:50:60', '5GHz', -90, { ssid: 'Far away' })
const SCAN = [HOME_5, HOME_5_GUEST, HOME_24, NEXT_5, NEXT_24, FAR]

const choices = (pairs: [ScanEntry, ScanChoice][]) =>
  new Map(pairs.map(([e, c]) => [e.bssid, c]))

const ANSWERS = choices([
  [HOME_5, { apId: 'router' }],
  [HOME_5_GUEST, { apId: 'router' }],
  [HOME_24, { apId: 'router' }],
  [NEXT_5, 'neighbour'],
  [NEXT_24, 'neighbour'],
  [FAR, 'ignore'],
])

describe('planScan and applyScan (D80)', () => {
  it('maps your BSSIDs, tunes radios on Auto, adds neighbours and ignores the rest', () => {
    const plan = sample()
    const changes = planScan(plan, SCAN, ANSWERS, tuning)
    expect(changes.radios).toEqual([
      {
        apId: 'router',
        band: '5GHz',
        bssids: [HOME_5.bssid, HOME_5_GUEST.bssid],
        widthMHz: 80,
        channel: 42,
        alreadySet: false,
      },
      // netsh-like: no width, so the radio stays on Auto.
      {
        apId: 'router',
        band: '2.4GHz',
        bssids: [HOME_24.bssid],
        alreadySet: false,
      },
    ])
    expect(changes.neighbours).toEqual([
      {
        bssid: NEXT_24.bssid,
        name: 'Next door',
        band: '2.4GHz',
        widthMHz: 20,
        widthAssumed: false,
        channel: 1,
        strengthDbm: -78,
      },
      {
        bssid: NEXT_5.bssid,
        name: 'Next door',
        band: '5GHz',
        widthMHz: 80,
        widthAssumed: true,
        channel: 155,
        strengthDbm: -84,
      },
    ])
    expect(changes.ignored).toEqual([FAR.bssid])

    let summary
    const after = produce(plan, (draft) => {
      summary = applyScan(draft, changes)
    })
    expect(summary).toEqual({
      bssidsMapped: 3,
      radiosTuned: 1,
      neighboursAdded: 2,
      neighboursUpdated: 0,
      bssidsIgnored: 1,
    })
    const radios = after.accessPoints[0]!.radios
    expect(radios[1]).toEqual({
      band: '5GHz',
      bssids: [HOME_5.bssid, HOME_5_GUEST.bssid],
      channelWidthMHz: 80,
      channel: 42,
    })
    expect(radios[0]).toEqual({ band: '2.4GHz', bssids: [HOME_24.bssid] })
    expect(after.neighbourNetworks).toHaveLength(2)
    expect(after.ignoredBssids).toEqual([FAR.bssid])
    expect(parsePlan(after).ok).toBe(true)
    expect(unknownScanEntries(after, SCAN)).toEqual([])
  })

  it('answers a later scan from what the plan knows, updating neighbours in place', () => {
    const first = produce(sample(), (draft) => {
      applyScan(draft, planScan(draft, SCAN, ANSWERS, tuning))
    })
    const id = first.neighbourNetworks![1]!.id
    const renamed = produce(first, (draft) => {
      draft.neighbourNetworks![1]!.name = 'Flat 2'
    })
    const later = [
      { ...NEXT_5, dbm: -70, channel: 157 },
      { ...HOME_5, channel: 149 },
    ]
    const changes = planScan(renamed, later, new Map(), tuning)
    expect(changes.neighbours).toEqual([
      {
        id,
        bssid: NEXT_5.bssid,
        name: 'Next door',
        band: '5GHz',
        widthMHz: 80,
        widthAssumed: false,
        channel: 155,
        strengthDbm: -70,
      },
    ])
    const after = produce(renamed, (draft) => {
      applyScan(draft, changes)
    })
    // The name typed in is kept.
    expect(after.neighbourNetworks![1]).toEqual({
      id,
      name: 'Flat 2',
      bssid: NEXT_5.bssid,
      band: '5GHz',
      channelWidthMHz: 80,
      channel: 155,
      strengthDbm: -70,
    })
    // The router's 5 GHz radio was tuned by the first scan, not by hand, but
    // it now has a width, so a different channel asks first.
    expect(changes.radios).toEqual([
      {
        apId: 'router',
        band: '5GHz',
        bssids: [],
        widthMHz: 80,
        channel: 155,
        alreadySet: true,
      },
    ])
    expect(after.accessPoints[0]!.radios[1]!.channel).toBe(42)
    const retuned = produce(renamed, (draft) => {
      applyScan(draft, changes, new Set([radioKey('router', '5GHz')]))
    })
    expect(retuned.accessPoints[0]!.radios[1]!.channel).toBe(155)
  })

  it('skips BSSIDs without an answer, and ones given to a radio that isn’t there', () => {
    const plan = produce(sample(), (draft) => {
      draft.accessPoints[0]!.radios = [{ band: '5GHz' }]
    })
    const changes = planScan(
      plan,
      SCAN,
      choices([[HOME_24, { apId: 'router' }]]),
      tuning,
    )
    expect(changes).toEqual({
      radios: [],
      neighbours: [],
      ignored: [],
      noRadio: [{ bssid: HOME_24.bssid, apId: 'router', band: '2.4GHz' }],
    })
  })

  it('takes a BSSID off the ignored list when given to a radio', () => {
    const plan = produce(sample(), (draft) => {
      draft.ignoredBssids = [HOME_5.bssid]
    })
    // Ignored BSSIDs aren't asked about again…
    expect(unknownScanEntries(plan, [HOME_5])).toEqual([])
    expect(planScan(plan, [HOME_5], new Map(), tuning).radios).toEqual([])
    // …but the plan can still be told otherwise.
    const changes = planScan(
      { ...plan, ignoredBssids: undefined } as unknown as Plan,
      [HOME_5],
      choices([[HOME_5, { apId: 'router' }]]),
      tuning,
    )
    const after = produce(plan, (draft) => {
      applyScan(draft, changes)
    })
    expect(after.ignoredBssids).toBeUndefined()
    expect(after.accessPoints[0]!.radios[1]!.bssids).toEqual([HOME_5.bssid])
  })

  it('counts a neighbour as updated only when the scan changed it', () => {
    const first = produce(sample(), (draft) => {
      applyScan(draft, planScan(draft, SCAN, ANSWERS, tuning))
    })
    let summary
    produce(first, (draft) => {
      summary = applyScan(draft, planScan(draft, SCAN, new Map(), tuning))
    })
    expect(summary).toEqual({
      bssidsMapped: 0,
      radiosTuned: 0,
      neighboursAdded: 0,
      neighboursUpdated: 0,
      bssidsIgnored: 0,
    })
  })
})
