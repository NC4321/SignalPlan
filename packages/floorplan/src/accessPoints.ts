import type { Point } from './geometry.ts'
import { BANDS, type AccessPoint, type Band, type Plan } from './schema.ts'

/**
 * Editing operations on access points (D25). Like the floor operations in
 * `edit.ts`, each one mutates the plan it is given, so it works on an Immer
 * draft as well as a plain object, and keeps the plan valid.
 */

/** Mounting height of a new access point: a router on a desk or shelf. */
export const NEW_ACCESS_POINT_HEIGHT_M = 1

/** Lowest and highest EIRP a radio can be set to, as in the schema. */
export const EIRP_RANGE_DBM = { min: -10, max: 40 } as const

/** "Access point N", with N one more than the highest already used. */
export function nextAccessPointName(plan: Plan): string {
  let n = 1
  for (const ap of plan.accessPoints) {
    const match = /^Access point (\d+)$/.exec(ap.name)
    if (match) n = Math.max(n, Number(match[1]) + 1)
  }
  return `Access point ${n}`
}

function nextAccessPointId(plan: Plan): string {
  const used = new Set(plan.accessPoints.map((ap) => ap.id))
  let n = 1
  while (used.has(`ap${n}`)) n++
  return `ap${n}`
}

function find(plan: Plan, id: string): AccessPoint {
  const ap = plan.accessPoints.find((a) => a.id === id)
  if (!ap) throw new Error(`No access point with id "${id}".`)
  return ap
}

/**
 * Adds an access point at `at` on a floor with a radio on every band at its
 * default power, and returns its id.
 */
export function addAccessPoint(plan: Plan, floorId: string, at: Point): string {
  const id = nextAccessPointId(plan)
  plan.accessPoints.push({
    id,
    name: nextAccessPointName(plan),
    floorId,
    x: at.x,
    y: at.y,
    heightM: NEW_ACCESS_POINT_HEIGHT_M,
    radios: BANDS.map((band) => ({ band })),
  })
  return id
}

export function deleteAccessPoint(plan: Plan, id: string) {
  plan.accessPoints = plan.accessPoints.filter((ap) => ap.id !== id)
}

/**
 * Turns a band's radio on (at its default power) or off. The last radio of an
 * access point can't be turned off, since each has at least one; this returns
 * false when nothing changed.
 */
export function setRadioOn(
  plan: Plan,
  id: string,
  band: Band,
  on: boolean,
): boolean {
  const ap = find(plan, id)
  const has = ap.radios.some((r) => r.band === band)
  if (on === has) return false
  if (on) {
    ap.radios.push({ band })
    ap.radios.sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band))
    return true
  }
  if (ap.radios.length === 1) return false
  ap.radios = ap.radios.filter((r) => r.band !== band)
  return true
}

/**
 * Sets a radio's EIRP in dBm, clamped to the schema's range; undefined goes
 * back to the band's default.
 */
export function setRadioPower(
  plan: Plan,
  id: string,
  band: Band,
  dbm: number | undefined,
) {
  const radio = find(plan, id).radios.find((r) => r.band === band)
  if (!radio) throw new Error(`Access point "${id}" has no ${band} radio.`)
  if (dbm === undefined) delete radio.txPowerDbm
  else {
    radio.txPowerDbm = Math.min(
      EIRP_RANGE_DBM.max,
      Math.max(EIRP_RANGE_DBM.min, dbm),
    )
  }
}
