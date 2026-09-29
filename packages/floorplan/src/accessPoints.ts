import type { Point } from './geometry.ts'
import { dropOrphanReadings } from './survey.ts'
import {
  BANDS,
  type AccessPoint,
  type Band,
  type ChannelWidth,
  type Plan,
  type Radio,
} from './schema.ts'

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

/** Deletes an access point and the survey readings taken from it (D71). */
export function deleteAccessPoint(plan: Plan, id: string) {
  plan.accessPoints = plan.accessPoints.filter((ap) => ap.id !== id)
  dropOrphanReadings(plan)
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
  const radio = findRadio(plan, id, band)
  if (dbm === undefined) delete radio.txPowerDbm
  else {
    radio.txPowerDbm = Math.min(
      EIRP_RANGE_DBM.max,
      Math.max(EIRP_RANGE_DBM.min, dbm),
    )
  }
}

function findRadio(plan: Plan, id: string, band: Band): Radio {
  const radio = find(plan, id).radios.find((r) => r.band === band)
  if (!radio) throw new Error(`Access point "${id}" has no ${band} radio.`)
  return radio
}

/**
 * Sets a radio's channel width, or leaves it to the planner when undefined
 * (D63). Channel numbers depend on the width, so a new width also leaves the
 * channel to the planner. Returns false when nothing changed.
 */
export function setRadioWidth(
  plan: Plan,
  id: string,
  band: Band,
  width: ChannelWidth | undefined,
): boolean {
  const radio = findRadio(plan, id, band)
  if (radio.channelWidthMHz === width) return false
  delete radio.channel
  if (width === undefined) delete radio.channelWidthMHz
  else radio.channelWidthMHz = width
  return true
}

/**
 * Fixes a radio's channel at its current width, or leaves the channel to the
 * planner when undefined (D63). A channel needs a width, so setting one on a
 * radio without a width throws. Returns false when nothing changed.
 */
export function setRadioChannel(
  plan: Plan,
  id: string,
  band: Band,
  channel: number | undefined,
): boolean {
  const radio = findRadio(plan, id, band)
  if (radio.channel === channel) return false
  if (channel === undefined) {
    delete radio.channel
    return true
  }
  if (radio.channelWidthMHz === undefined) {
    throw new Error(`Set a width before a channel on "${id}" ${band}.`)
  }
  radio.channel = channel
  return true
}
