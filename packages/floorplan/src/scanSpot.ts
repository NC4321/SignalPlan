import {
  NEIGHBOUR_STRENGTH_RANGE_DBM,
  type Band,
  type NeighbourReading,
  type Plan,
  type SurveyReading,
} from './schema.ts'
import type { ScanChanges } from './scanApply.ts'
import { scanDeviceKey, type ScanEntry } from './scanImport.ts'
import { addSurveySpot, findSurveySpot } from './survey.ts'
import { bssidOwners, meanPowerDbm } from './surveyImport.ts'

/**
 * A scan at a survey spot (D82): after `applyScan` has matched the scan's
 * BSSIDs, your own become the spot's readings and the neighbours' are kept
 * at the spot, so each neighbour network's strength can be the strongest it
 * was heard at anywhere in the home.
 */

/** Where a scan was taken: an existing spot, or a new one at a point. */
export type ScanPlace =
  { spotId: string } | { floorId: string; x: number; y: number }

export interface SpotScanSummary {
  spotId: string
  spotAdded: boolean
  /** Readings the spot didn't have before. */
  readingsAdded: number
  /** Readings averaged with earlier scans at the spot. */
  readingsAveraged: number
  /** Neighbour networks whose strength was set from every spot's scans. */
  neighboursHeard: number
}

/**
 * The mean power of a value that's already the mean of `count` scans and
 * one more scan, in dBm to 0.1 dB, as D72 averages readings.
 */
export function addScanToMean(
  meanDbm: number,
  count: number,
  dbm: number,
): number {
  const mw = count * 10 ** (meanDbm / 10) + 10 ** (dbm / 10)
  return Math.round(10 * 10 * Math.log10(mw / (count + 1))) / 10
}

/** One scan's value for a reading: several BSSIDs of one radio, at mean power. */
interface ScanValue {
  dbm: number
  approximate: boolean
}

function scanValue(entries: readonly ScanEntry[]): ScanValue {
  return {
    dbm: meanPowerDbm(entries.map((e) => e.dbm)),
    approximate: entries.some((e) => e.approximate),
  }
}

/** Averages a scan into a reading that has one, weighted by its scan count. */
function averageInto(
  reading: SurveyReading | NeighbourReading,
  value: ScanValue,
) {
  const count = reading.scans ?? 1
  reading.dbm = addScanToMean(reading.dbm, count, value.dbm)
  reading.scans = count + 1
  if (value.approximate) reading.approximate = true
}

function withValue<T extends object>(fields: T, value: ScanValue) {
  return value.approximate
    ? { ...fields, dbm: value.dbm, approximate: true as const }
    : { ...fields, dbm: value.dbm }
}

/**
 * Adds a scan to a survey spot, on an Immer draft, after `applyScan` with the
 * same `changes`, in the same edit so it's one undo step. Each of your
 * radios heard becomes a reading (its BSSIDs at mean power), averaged with
 * the spot's reading for it, if any, by how many scans that one is the mean
 * of. A BSSID given to an access point without a radio on its band becomes
 * a reading on that band, which isn't compared while the band is off (D71).
 * Each neighbour's BSSID heard is kept at the spot, averaged the same way,
 * and each neighbour network the scan heard takes the strongest of its
 * device's BSSIDs on its band at any spot.
 */
export function applyScanAtSpot(
  plan: Plan,
  entries: readonly ScanEntry[],
  changes: ScanChanges,
  place: ScanPlace,
): SpotScanSummary {
  const spotAdded = !('spotId' in place)
  const spotId =
    'spotId' in place
      ? place.spotId
      : addSurveySpot(plan, place.floorId, { x: place.x, y: place.y })
  const spot = findSurveySpot(plan, spotId)?.spot
  if (!spot) throw new Error(`No survey spot with id "${spotId}".`)
  const summary: SpotScanSummary = {
    spotId,
    spotAdded,
    readingsAdded: 0,
    readingsAveraged: 0,
    neighboursHeard: 0,
  }

  const owners = bssidOwners(plan)
  const noRadio = new Map(changes.noRadio.map((n) => [n.bssid, n]))
  const mine = new Map<
    string,
    { apId: string; band: Band; entries: ScanEntry[] }
  >()
  for (const entry of entries) {
    const owner = owners.get(entry.bssid) ?? noRadio.get(entry.bssid)
    if (!owner) continue
    const key = `${owner.apId}\n${owner.band}`
    const group = mine.get(key) ?? {
      apId: owner.apId,
      band: owner.band,
      entries: [],
    }
    group.entries.push(entry)
    mine.set(key, group)
  }
  for (const { apId, band, entries: group } of mine.values()) {
    const value = scanValue(group)
    const existing = spot.readings.find(
      (r) => r.apId === apId && r.band === band,
    )
    if (existing) {
      averageInto(existing, value)
      summary.readingsAveraged++
    } else {
      spot.readings.push(withValue({ apId, band }, value))
      summary.readingsAdded++
    }
  }

  for (const entry of changes.neighbourEntries) {
    const value = scanValue([entry])
    spot.neighbourReadings ??= []
    const existing = spot.neighbourReadings.find((n) => n.bssid === entry.bssid)
    if (existing) {
      existing.band = entry.band
      averageInto(existing, value)
    } else {
      spot.neighbourReadings.push(
        withValue({ bssid: entry.bssid, band: entry.band }, value),
      )
    }
  }

  // Each network's strength: the strongest its device was heard at, on
  // its band, at any spot.
  const heard = new Set(
    changes.neighbourEntries.map((e) => `${scanDeviceKey(e.bssid)}\n${e.band}`),
  )
  const strongest = new Map<string, number>()
  for (const floor of plan.floors) {
    for (const s of floor.surveySpots ?? []) {
      for (const n of s.neighbourReadings ?? []) {
        const key = `${scanDeviceKey(n.bssid)}\n${n.band}`
        strongest.set(key, Math.max(strongest.get(key) ?? -Infinity, n.dbm))
      }
    }
  }
  const { min, max } = NEIGHBOUR_STRENGTH_RANGE_DBM
  for (const network of plan.neighbourNetworks ?? []) {
    if (network.bssid === undefined) continue
    const key = `${scanDeviceKey(network.bssid)}\n${network.band}`
    const dbm = strongest.get(key)
    if (!heard.has(key) || dbm === undefined) continue
    network.strengthDbm = Math.round(Math.min(max, Math.max(min, dbm)))
    summary.neighboursHeard++
  }
  return summary
}
