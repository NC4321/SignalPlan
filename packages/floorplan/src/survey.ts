import type { Point } from './geometry.ts'
import {
  SURVEY_READING_RANGE_DBM,
  type Band,
  type Plan,
  type SurveyReading,
  type SurveySpot,
} from './schema.ts'

/**
 * Editing operations on survey spots, their readings and radios' BSSIDs
 * (D70, D71). Like the other operations, each mutates the plan it's given,
 * so it works on an Immer draft, and returns false when nothing changed.
 */

/** A new reading's value, until the measured one is typed in. */
export const NEW_READING_DBM = -60

function nextSpotId(plan: Plan): string {
  const used = new Set(
    plan.floors.flatMap((f) => (f.surveySpots ?? []).map((s) => s.id)),
  )
  let n = 1
  while (used.has(`spot${n}`)) n++
  return `spot${n}`
}

/** A spot's name for lists and undo labels: `spot3` is "Spot 3". */
export function surveySpotName(id: string): string {
  const match = /^spot(\d+)$/.exec(id)
  return match ? `Spot ${match[1]}` : id
}

/** The spot with this id and the floor it's on, if there is one. */
export function findSurveySpot(
  plan: Plan,
  id: string,
): { spot: SurveySpot; floorId: string } | undefined {
  for (const floor of plan.floors) {
    const spot = floor.surveySpots?.find((s) => s.id === id)
    if (spot) return { spot, floorId: floor.id }
  }
  return undefined
}

function find(plan: Plan, id: string): SurveySpot {
  const found = findSurveySpot(plan, id)
  if (!found) throw new Error(`No survey spot with id "${id}".`)
  return found.spot
}

/** Adds a spot with no readings yet on a floor, and returns its id. */
export function addSurveySpot(plan: Plan, floorId: string, at: Point): string {
  const floor = plan.floors.find((f) => f.id === floorId)
  if (!floor) throw new Error(`No floor with id "${floorId}".`)
  const id = nextSpotId(plan)
  floor.surveySpots ??= []
  floor.surveySpots.push({ id, x: at.x, y: at.y, readings: [] })
  return id
}

export function moveSurveySpot(
  plan: Plan,
  id: string,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 && dy === 0) return false
  const spot = find(plan, id)
  spot.x += dx
  spot.y += dy
  return true
}

export function deleteSurveySpot(plan: Plan, id: string): boolean {
  for (const floor of plan.floors) {
    const spots = floor.surveySpots
    const i = spots?.findIndex((s) => s.id === id) ?? -1
    if (!spots || i < 0) continue
    spots.splice(i, 1)
    if (spots.length === 0) delete floor.surveySpots
    return true
  }
  return false
}

/** Sets the note, or clears it when blank. */
export function setSurveyNote(plan: Plan, id: string, note: string): boolean {
  const spot = find(plan, id)
  const trimmed = note.trim().slice(0, 500)
  if ((spot.note ?? '') === trimmed) return false
  if (trimmed === '') delete spot.note
  else spot.note = trimmed
  return true
}

const sameSource = (a: Omit<SurveyReading, 'dbm'>, b: typeof a) =>
  a.apId === b.apId && a.band === b.band

/**
 * Adds a reading for the first access point and band, in plan order, that
 * the spot has none for yet, at `NEW_READING_DBM`. Access points on the
 * spot's own floor come first. Returns false when every radio has one.
 */
export function addSurveyReading(plan: Plan, id: string): boolean {
  const found = findSurveySpot(plan, id)
  if (!found) throw new Error(`No survey spot with id "${id}".`)
  const { spot, floorId } = found
  const aps = [
    ...plan.accessPoints.filter((ap) => ap.floorId === floorId),
    ...plan.accessPoints.filter((ap) => ap.floorId !== floorId),
  ]
  for (const ap of aps) {
    for (const { band } of ap.radios) {
      const source = { apId: ap.id, band }
      if (spot.readings.some((r) => sameSource(r, source))) continue
      spot.readings.push({ ...source, dbm: NEW_READING_DBM })
      return true
    }
  }
  return false
}

/**
 * Changes which access point and band a reading is from. A spot has one
 * reading per access point and band, so a change onto one it already has is
 * refused. Picking only an access point keeps the reading's band if it has
 * that radio and no reading on it yet, or else takes its first radio without
 * one; with none free, nothing changes.
 */
export function setReadingSource(
  plan: Plan,
  id: string,
  index: number,
  source: { apId: string; band?: Band },
): boolean {
  const spot = find(plan, id)
  const reading = spot.readings[index]
  if (!reading) throw new RangeError(`No reading ${index} on "${id}".`)
  const ap = plan.accessPoints.find((a) => a.id === source.apId)
  if (!ap) throw new Error(`No access point with id "${source.apId}".`)
  const taken = (band: Band) =>
    spot.readings.some(
      (r, i) => i !== index && sameSource(r, { apId: ap.id, band }),
    )
  const own = ap.radios.map((r) => r.band)
  const order = own.includes(reading.band)
    ? [reading.band, ...own.filter((b) => b !== reading.band)]
    : own
  const band = source.band ?? order.find((b) => !taken(b))
  if (band === undefined || taken(band)) return false
  const next = { apId: ap.id, band }
  if (sameSource(reading, next)) return false
  reading.apId = next.apId
  reading.band = next.band
  return true
}

/** Sets a reading's value, clamped to the schema's range. */
export function setReadingDbm(
  plan: Plan,
  id: string,
  index: number,
  dbm: number,
): boolean {
  const reading = find(plan, id).readings[index]
  if (!reading) throw new RangeError(`No reading ${index} on "${id}".`)
  const clamped = Math.min(
    SURVEY_READING_RANGE_DBM.max,
    Math.max(SURVEY_READING_RANGE_DBM.min, dbm),
  )
  if (reading.dbm === clamped) return false
  reading.dbm = clamped
  return true
}

export function deleteSurveyReading(
  plan: Plan,
  id: string,
  index: number,
): boolean {
  const spot = find(plan, id)
  if (index < 0 || index >= spot.readings.length) return false
  spot.readings.splice(index, 1)
  return true
}

/**
 * Drops every reading taken from access points that aren't in the plan any
 * more, such as after one is deleted (D71). Spots stay, even when empty.
 */
export function dropOrphanReadings(plan: Plan) {
  const ids = new Set(plan.accessPoints.map((ap) => ap.id))
  for (const floor of plan.floors) {
    for (const spot of floor.surveySpots ?? []) {
      if (spot.readings.every((r) => ids.has(r.apId))) continue
      spot.readings = spot.readings.filter((r) => ids.has(r.apId))
    }
  }
}

/**
 * The strongest reading at a spot on a band, from any access point, or
 * undefined when it has none on that band. Pins show it (D71).
 */
export function strongestReading(
  spot: { readonly readings: readonly SurveyReading[] },
  band: Band,
): number | undefined {
  let best: number | undefined
  for (const r of spot.readings) {
    if (r.band === band && (best === undefined || r.dbm > best)) best = r.dbm
  }
  return best
}

/**
 * Reads BSSIDs typed or pasted in: separated by commas, spaces or new lines,
 * with colons, dashes or dots, in any case (D71), with or without leading
 * zeros in each pair (D72). Returns them lower case
 * with colons, without repeats, and the pieces that aren't BSSIDs.
 */
export function parseBssids(text: string): {
  bssids: string[]
  invalid: string[]
} {
  const bssids: string[] = []
  const invalid: string[] = []
  for (const piece of text.split(/[\s,;]+/)) {
    if (piece === '') continue
    // macOS tools drop leading zeros: 0:1a:2b:3c:4d:5e (D72).
    const octets = piece.split(/[:-]/)
    const hex = (
      octets.length === 6 && octets.every((o) => /^[0-9a-f]{1,2}$/i.test(o))
        ? octets.map((o) => o.padStart(2, '0')).join('')
        : piece.replace(/[:.-]/g, '')
    ).toLowerCase()
    if (!/^[0-9a-f]{12}$/.test(hex)) {
      invalid.push(piece)
      continue
    }
    const bssid = hex.match(/../g)!.join(':')
    if (!bssids.includes(bssid)) bssids.push(bssid)
  }
  return { bssids, invalid }
}

/**
 * The access point and band that already have this BSSID, other than
 * `except`: a BSSID belongs to one radio.
 */
export function bssidOwner(
  plan: Plan,
  bssid: string,
  except?: { apId: string; band: Band },
): { apId: string; band: Band } | undefined {
  for (const ap of plan.accessPoints) {
    for (const radio of ap.radios) {
      if (except && ap.id === except.apId && radio.band === except.band) {
        continue
      }
      if (radio.bssids?.includes(bssid))
        return { apId: ap.id, band: radio.band }
    }
  }
  return undefined
}

/**
 * Sets a radio's BSSIDs, or clears them when the list is empty. A BSSID that
 * another radio already has is an error: the caller checks with
 * `bssidOwner` first.
 */
export function setRadioBssids(
  plan: Plan,
  apId: string,
  band: Band,
  bssids: readonly string[],
): boolean {
  const radio = plan.accessPoints
    .find((a) => a.id === apId)
    ?.radios.find((r) => r.band === band)
  if (!radio) throw new Error(`Access point "${apId}" has no ${band} radio.`)
  for (const bssid of bssids) {
    if (bssidOwner(plan, bssid, { apId, band })) {
      throw new Error(`${bssid} already belongs to another radio.`)
    }
  }
  const before = radio.bssids ?? []
  if (
    before.length === bssids.length &&
    before.every((b, i) => b === bssids[i])
  ) {
    return false
  }
  if (bssids.length === 0) delete radio.bssids
  else radio.bssids = [...bssids]
  // A BSSID typed onto a radio is yours after all (D72).
  if (plan.ignoredBssids?.some((b) => bssids.includes(b))) {
    const kept = plan.ignoredBssids.filter((b) => !bssids.includes(b))
    if (kept.length === 0) delete plan.ignoredBssids
    else plan.ignoredBssids = kept
  }
  return true
}

/** Forgets every BSSID marked not mine, so imports ask about them again. */
export function forgetIgnoredBssids(plan: Plan): boolean {
  if (!plan.ignoredBssids) return false
  delete plan.ignoredBssids
  return true
}
