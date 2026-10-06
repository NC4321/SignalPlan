import {
  accessPointSightings,
  bssidSightings,
  DEFAULT_CELL_M,
  floorAreaMask,
  gridForFloor,
  MIN_LOCATE_SPOTS,
  OUTSIDE_REACH_M,
  tryLocateSource,
  type LocateResult,
  type Location,
  type Unplaced,
} from '@signalplan/engine'
import {
  BANDS,
  scanDeviceKey,
  type Band,
  type NeighbourLocation,
  type NeighbourNetwork,
  type Plan,
} from '@signalplan/floorplan'
import type { Units } from './units.ts'

/**
 * Locating in the editor (D85): a neighbour's network from the scans heard
 * at survey spots, and a check of where one of your access points is from
 * its readings, with the words the panel shows. The fit is the engine's
 * (D83); nothing here shows more precision than its radius.
 */

/**
 * The BSSIDs of a scanned neighbour's device heard at any spot on its band:
 * the network's own and those that look like the same device, as a scan
 * at a spot counts them for its strength (D82).
 */
export function neighbourBssids(plan: Plan, network: NeighbourNetwork) {
  if (network.bssid === undefined) return []
  const key = scanDeviceKey(network.bssid)
  const bssids = new Set([network.bssid])
  for (const floor of plan.floors) {
    for (const spot of floor.surveySpots ?? []) {
      for (const r of spot.neighbourReadings ?? []) {
        if (r.band === network.band && scanDeviceKey(r.bssid) === key) {
          bssids.add(r.bssid)
        }
      }
    }
  }
  return [...bssids]
}

/** How many spots a neighbour's network was heard at by scans. */
export function neighbourSpotCount(plan: Plan, network: NeighbourNetwork) {
  return bssidSightings(plan, neighbourBssids(plan, network), network.band)
    .length
}

/**
 * Where the scans put a neighbour's network, or why they can't place it:
 * heard at fewer than 3 spots, or heard too weakly or strongly for any
 * position within OUTSIDE_REACH_M of the walls to fit (D103).
 */
export function tryLocateNeighbour(
  plan: Plan,
  network: NeighbourNetwork,
): LocateResult {
  const sightings = bssidSightings(
    plan,
    neighbourBssids(plan, network),
    network.band,
  )
  return tryLocateSource(plan, network.band, sightings, { outside: true })
}

/** Where the scans put a neighbour's network, if they can place it. */
export function locateNeighbour(
  plan: Plan,
  network: NeighbourNetwork,
): Location | undefined {
  const result = tryLocateNeighbour(plan, network)
  return 'location' in result ? result.location : undefined
}

/**
 * What the editor says when the scans can't place a neighbour's network,
 * after its label: why, and what it does instead.
 */
export function describeUnplacedNeighbour(
  reason: Unplaced,
  located: boolean,
  units: Units,
): string {
  const reach = formatRadius(OUTSIDE_REACH_M, units)
  const why =
    reason === 'few-spots'
      ? `heard by scans at too few spots to place it. It needs ${MIN_LOCATE_SPOTS}.`
      : reason === 'too-strong'
        ? `heard too strongly to place. No spot within ${reach} of the walls fits its scans.`
        : `heard too weakly to place. It’s probably more than ${reach} past the walls.`
  return `${why} ${located ? 'Its last location is kept.' : 'It still counts at one strength everywhere.'}`
}

/**
 * A fit as a neighbour's saved location, rounded to centimetres and tenths
 * of a dB: finer than any fit, so nothing is lost.
 */
export function toNeighbourLocation(location: Location): NeighbourLocation {
  const round = (value: number, step: number) => Math.round(value / step) * step
  return {
    floorId: location.floorId,
    x: round(location.x, 0.01),
    y: round(location.y, 0.01),
    heightM: location.heightM,
    eirpDbm: round(location.eirpDbm, 0.1),
    uncertaintyM: round(location.uncertaintyM, 0.1),
  }
}

/**
 * An uncertainty radius in whole metres or feet, rounded up, never below
 * one: the panel never shows a located position more precisely than that.
 */
export function formatRadius(metres: number, units: Units): string {
  if (units === 'metric') return `${Math.max(1, Math.ceil(metres))} m`
  return `${Math.max(1, Math.ceil(metres / 0.3048))} ft`
}

const floorName = (plan: Plan, floorId: string) =>
  plan.floors.find((f) => f.id === floorId)?.name || 'a floor'

/**
 * What the panel says about a neighbour's location: which floor, inside or
 * outside, to within what, and when a wall is closer than that.
 */
export function describeNeighbourLocation(
  plan: Plan,
  location: NeighbourLocation,
  units: Units,
): string {
  const where =
    plan.floors.length > 1 ? ` on ${floorName(plan, location.floorId)}` : ''
  const outside = outsideFloor(plan, location)
  const nearWall = nearestWallM(plan, location) < location.uncertaintyM
  return [
    `Located${where}${outside ? ', outside the walls' : ''}, to within ${formatRadius(location.uncertaintyM, units)}, sending about ${Math.round(location.eirpDbm)} dBm.`,
    nearWall
      ? 'A wall is closer than that, so it may be on either side of it.'
      : undefined,
    'Its signal is predicted from there through walls and floors.',
  ]
    .filter((s) => s !== undefined)
    .join(' ')
}

/**
 * Whether a point lies outside its floor's walls, as the coverage summary
 * finds the floor (`floorAreaMask`). A floor without walls has no outside.
 */
export function outsideFloor(
  plan: Plan,
  point: { floorId: string; x: number; y: number },
): boolean {
  const floor = plan.floors.find((f) => f.id === point.floorId)
  if (!floor || floor.walls.length === 0) return false
  const grid = gridForFloor(floor, DEFAULT_CELL_M)
  const col = Math.floor((point.x - grid.originX) / grid.cellM)
  const row = Math.floor((point.y - grid.originY) / grid.cellM)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return true
  return floorAreaMask(floor, grid)[row * grid.cols + col] === 0
}

/** The distance from a point to the nearest wall on its floor, in metres. */
export function nearestWallM(
  plan: Plan,
  point: { floorId: string; x: number; y: number },
): number {
  const floor = plan.floors.find((f) => f.id === point.floorId)
  if (!floor) return Number.POSITIVE_INFINITY
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]))
  let nearest = Number.POSITIVE_INFINITY
  for (const wall of floor.walls) {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t =
      lengthSq > 0
        ? Math.min(
            Math.max(
              ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq,
              0,
            ),
            1,
          )
        : 0
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy),
    )
  }
  return nearest
}

/** A check of where one of your access points is, from its readings (D85). */
export interface PositionCheck {
  apId: string
  band: Band
  location: Location
}

/**
 * The band with readings of an access point at the most spots, at least
 * MIN_LOCATE_SPOTS; the first in `BANDS` order on a tie. Undefined without.
 */
export function checkBand(plan: Plan, apId: string): Band | undefined {
  let best: { band: Band; spots: number } | undefined
  for (const band of BANDS) {
    const spots = accessPointSightings(plan, apId, band).length
    if (spots >= MIN_LOCATE_SPOTS && (!best || spots > best.spots)) {
      best = { band, spots }
    }
  }
  return best?.band
}

/**
 * Where an access point's readings put it: inside the walls, at its own
 * mounting height, on the band read at the most spots. Or why they can't
 * place it: too few, or too weak or strong for anywhere inside (D103).
 */
export function tryCheckPosition(
  plan: Plan,
  apId: string,
): PositionCheck | Unplaced {
  const ap = plan.accessPoints.find((a) => a.id === apId)
  const band = checkBand(plan, apId)
  if (!ap || !band) return 'few-spots'
  const result = tryLocateSource(
    plan,
    band,
    accessPointSightings(plan, apId, band),
    { heightM: ap.heightM, outside: false },
  )
  return 'location' in result
    ? { apId, band, location: result.location }
    : result.unplaced
}

/** Where an access point's readings put it, if they can place it. */
export function checkPosition(
  plan: Plan,
  apId: string,
): PositionCheck | undefined {
  const result = tryCheckPosition(plan, apId)
  return typeof result === 'string' ? undefined : result
}

/** What the editor says when an access point's readings can't place it. */
export function describeUnplacedCheck(reason: Unplaced): string {
  switch (reason) {
    case 'few-spots':
      return `Its readings are too few to check its position: it needs them at ${MIN_LOCATE_SPOTS} spots on one band.`
    case 'too-strong':
      return 'Its readings are heard too strongly to place it anywhere inside the walls, so its position can’t be checked.'
    default:
      return 'Its readings are heard too weakly to place it anywhere inside the walls, so its position can’t be checked. Check they’re of this access point.'
  }
}

/**
 * What the panel says about a check: whether the readings agree with where
 * the access point is, or how far off they put it, and to within what.
 */
export function describePositionCheck(
  plan: Plan,
  check: PositionCheck,
  units: Units,
): { text: string; agrees: boolean } {
  const ap = plan.accessPoints.find((a) => a.id === check.apId)
  const { location } = check
  const radius = formatRadius(location.uncertaintyM, units)
  if (!ap) return { text: '', agrees: true }
  const sameFloor = ap.floorId === location.floorId
  const distance = Math.hypot(location.x - ap.x, location.y - ap.y)
  const agrees = sameFloor && distance <= location.uncertaintyM
  const others = location.otherFloorIds.map((id) => floorName(plan, id))
  const text = [
    agrees
      ? `The readings agree with where it is, to within ${radius}.`
      : sameFloor
        ? `The readings put it about ${formatRadius(distance, units)} from here, to within ${radius}.`
        : `The readings put it on ${floorName(plan, location.floorId)}, to within ${radius}.`,
    others.length > 0
      ? `${others.join(' or ')} would fit nearly as well.`
      : undefined,
    location.nearestWallM < location.uncertaintyM && !agrees
      ? 'A wall is closer than that, so it may be on either side of it.'
      : undefined,
  ]
    .filter((s) => s !== undefined)
    .join(' ')
  return { text, agrees }
}
