import {
  EIRP_RANGE_DBM,
  materialSegments,
  NEW_ACCESS_POINT_HEIGHT_M,
  type Band,
  type BandCalibration,
  type Plan,
} from '@signalplan/floorplan'
import { gridForFloor, RECEIVER_HEIGHT_M, signalDbm } from './coverage.ts'
import { indexedWallLoss, indexWalls } from './crossings.ts'
import { floorAreaMask } from './floorArea.ts'
import {
  crossingLossDb,
  floorCrossing,
  prepareStack,
  type Storey,
} from './floors.ts'

/**
 * Locating a transmitter from survey readings (D83): a neighbour's network,
 * or one of your own access points, read at three spots or more. The
 * unknowns are its position (a floor of the stack and x, y on it, inside
 * the home or out) and its power. For a trial position the model gives each
 * reading's path loss, so the best power is the mean of measured + loss and
 * the fit's error is what's left; the position is the one with the least
 * error, searched on a coarse grid and then refined. Positions whose error
 * is nearly as small give the uncertainty.
 */

/** One reading of the transmitter: where it was read, and its signal. */
export interface LocateReading {
  floorId: string
  x: number
  y: number
  dbm: number
}

export interface LocateOptions {
  /** The model's values for the band: the plan's calibration by default. */
  calibration?: BandCalibration
  /**
   * How far off the model typically is on this band, in dB, such as the
   * error report's RMS error for your own access points (D73). The
   * uncertainty uses it when it's more than the fit's own error.
   */
  modelErrorDb?: number
  /** How far beyond the home the search reaches, in metres (D83). */
  searchMarginM?: number
}

export interface Location {
  floorId: string
  x: number
  y: number
  /** The fitted EIRP in dBm, as the phone would see it from 1 m. */
  eirpDbm: number
  /** The fit wanted more power than any radio can be set to, so was held there. */
  eirpAtLimit: boolean
  /** RMS of measured minus predicted at the fitted position and power, in dB. */
  rmsDb: number
  /** How many readings were fitted. */
  readings: number
  /**
   * How far from the position, on its floor, others fit nearly as well
   * (95%), in metres; or Infinity when three readings fit exactly and
   * nothing says how far off the model is.
   */
  uncertaintyM: number
  /** Floors with a position nearly as good, the fitted one first. */
  floorIds: string[]
  /** The position is outside the floor's walls. */
  outside: boolean
  /**
   * A position nearly as good is at the edge of the search, so it may be
   * further away still.
   */
  atSearchEdge: boolean
  /** The distance to the nearest wall on its floor, in metres. */
  nearestWallM: number
}

/** A transmitter's location needs readings at this many spots or more. */
export const MIN_LOCATE_SPOTS = 3

/** Default search beyond the home's outer walls (D83). */
export const LOCATE_SEARCH_MARGIN_M = 20

/** The coarse grid's step, in metres. */
const COARSE_STEP_M = 1.5

/** The refinement stops at this step, in metres. */
const FINE_STEP_M = 0.01

/**
 * The 95% point of the χ² distribution with 2 degrees of freedom, for the
 * region of positions (x, y) nearly as good: −2·ln(0.05) ≈ 5.99.
 */
const CHI2_2_95 = -2 * Math.log(0.05)

/** A position's fit: the best power there and the sum of squared errors. */
interface Trial {
  storey: number
  x: number
  y: number
  eirpDbm: number
  atLimit: boolean
  sse: number
}

/**
 * The fitted position and power of a transmitter from its readings, or
 * undefined with fewer than `MIN_LOCATE_SPOTS` readings at distinct spots.
 * The transmitter is taken to be 1 m above a floor of the stack, like a
 * new access point, and the readings 1 m above theirs, as for every reading
 * (D73). The calibration's device offset is added, since readings are what
 * the phone showed (D76).
 */
export function locateTransmitter(
  plan: Plan,
  band: Band,
  readings: readonly LocateReading[],
  options: LocateOptions = {},
): Location | undefined {
  const spots = new Set(readings.map((r) => `${r.floorId} ${r.x} ${r.y}`))
  if (spots.size < MIN_LOCATE_SPOTS) return undefined
  const calibration = options.calibration ?? plan.calibration?.[band] ?? {}
  const stack = prepareStack(plan, band, calibration)
  const here = readings.map((r) =>
    stack.findIndex((s) => s.floor.id === r.floorId),
  )
  if (here.some((i) => i < 0)) {
    throw new Error('A reading is on a floor the plan doesn’t have.')
  }
  const offset = calibration.deviceOffsetDb ?? 0
  const exponent = calibration.pathLossExponent
  const radio = { band, txPowerDbm: 0 }

  // Paths are worked out from each reading's spot, which is fixed, to the
  // trial position: the walls sorted by direction from the spot (D56), or
  // the slabs and storeys a path from there to each storey crosses.
  const sourceZ = (storey: number) =>
    stack[storey]!.floor.elevationM + NEW_ACCESS_POINT_HEIGHT_M
  const receiverZ = (storey: number) =>
    stack[storey]!.floor.elevationM + RECEIVER_HEIGHT_M
  const paths = readings.map((r, i) =>
    stack.map((_, storey) => {
      const spot = here[i]!
      return spot === storey
        ? { index: indexWalls(stack[spot]!.walls, r.x, r.y) }
        : {
            crossing: floorCrossing(
              stack,
              spot,
              receiverZ(spot),
              storey,
              sourceZ(storey),
              r,
            ),
          }
    }),
  )

  /** Measured minus the model's signal for 0 dBm EIRP, for each reading. */
  const evaluate = (storey: number, x: number, y: number): Trial => {
    const source = { x, y, heightM: NEW_ACCESS_POINT_HEIGHT_M }
    const gaps = readings.map((r, i) => {
      const path = paths[i]![storey]!
      const loss =
        'index' in path
          ? indexedWallLoss(path.index, r.x, r.y, x, y)
          : crossingLossDb(path.crossing, r.x, r.y, x, y)
      const dz = sourceZ(storey) - receiverZ(here[i]!)
      const gain =
        signalDbm(source, radio, r.x, r.y, loss, dz, exponent) + offset
      return r.dbm - gain
    })
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const atLimit = mean > EIRP_RANGE_DBM.max
    const eirpDbm = atLimit ? EIRP_RANGE_DBM.max : mean
    const sse = gaps.reduce((sum, g) => sum + (g - eirpDbm) ** 2, 0)
    return { storey, x, y, eirpDbm, atLimit, sse }
  }

  // The search area: the home and its readings, plus the margin.
  const margin = options.searchMarginM ?? LOCATE_SEARCH_MARGIN_M
  const points = [
    ...plan.floors.flatMap((f) => f.nodes),
    ...readings.map((r) => ({ x: r.x, y: r.y })),
  ]
  const minX = Math.min(...points.map((p) => p.x)) - margin
  const maxX = Math.max(...points.map((p) => p.x)) + margin
  const minY = Math.min(...points.map((p) => p.y)) - margin
  const maxY = Math.max(...points.map((p) => p.y)) + margin
  const cols = Math.floor((maxX - minX) / COARSE_STEP_M) + 1
  const rows = Math.floor((maxY - minY) / COARSE_STEP_M) + 1

  const coarse: Trial[] = []
  for (let storey = 0; storey < stack.length; storey++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        coarse.push(
          evaluate(
            storey,
            minX + col * COARSE_STEP_M,
            minY + row * COARSE_STEP_M,
          ),
        )
      }
    }
  }

  // Refine the best few: the true position is within half a cell of one.
  const starts = [...coarse].sort((a, b) => a.sse - b.sse).slice(0, 5)
  let best = starts[0]!
  for (const start of starts) {
    const refined = refine(start, evaluate)
    if (refined.sse < best.sse) best = refined
  }

  // How far off a reading typically is: the fit's own error with three
  // parameters spent (x, y and power), or the model's, whichever is more.
  const dof = readings.length - 3
  const variance = Math.max(
    dof > 0 ? best.sse / dof : 0,
    (options.modelErrorDb ?? 0) ** 2,
  )
  const within = (t: Trial) => t.sse <= best.sse + CHI2_2_95 * variance
  const nearlyAsGood =
    dof <= 0 && options.modelErrorDb === undefined
      ? coarse
      : [
          ...coarse.filter(within),
          ...fineRegion(best, coarse, within, evaluate),
        ]
  // Measured on the fitted floor; other floors nearly as good are listed.
  const uncertaintyM =
    dof <= 0 && options.modelErrorDb === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(
          0,
          ...nearlyAsGood
            .filter((t) => t.storey === best.storey)
            .map((t) => Math.hypot(t.x - best.x, t.y - best.y)),
        )
  const storeys = [best.storey, ...nearlyAsGood.map((t) => t.storey)]
  const onEdge = (t: Trial) =>
    t.x <= minX + 1e-9 ||
    t.x >= minX + (cols - 1) * COARSE_STEP_M - 1e-9 ||
    t.y <= minY + 1e-9 ||
    t.y >= minY + (rows - 1) * COARSE_STEP_M - 1e-9

  const floor = stack[best.storey]!.floor
  return {
    floorId: floor.id,
    x: best.x,
    y: best.y,
    eirpDbm: best.eirpDbm,
    eirpAtLimit: best.atLimit,
    rmsDb: Math.sqrt(best.sse / readings.length),
    readings: readings.length,
    uncertaintyM,
    floorIds: [...new Set(storeys)].map((s) => stack[s]!.floor.id),
    outside: !insideFloor(stack[best.storey]!, best.x, best.y),
    atSearchEdge: nearlyAsGood.some(onEdge),
    nearestWallM: nearestWallM(stack[best.storey]!, best.x, best.y),
  }
}

/** Step of the local grid around each start, in metres. */
const LOCAL_STEP_M = 0.1

/**
 * Refines a coarse trial: the best of a 0.1 m grid half a cell either way,
 * since a path's loss jumps where it starts or stops crossing a wall (or a
 * window in it), which can trap a search that only steps downhill; then a
 * pattern search from there, halving the step.
 */
function refine(
  start: Trial,
  evaluate: (storey: number, x: number, y: number) => Trial,
): Trial {
  let best = start
  const reach = Math.ceil(COARSE_STEP_M / 2 / LOCAL_STEP_M)
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const t = evaluate(
        start.storey,
        start.x + i * LOCAL_STEP_M,
        start.y + j * LOCAL_STEP_M,
      )
      if (t.sse < best.sse) best = t
    }
  }
  for (let step = LOCAL_STEP_M / 2; step >= FINE_STEP_M; step /= 2) {
    let moved = true
    while (moved) {
      moved = false
      for (const [dx, dy] of NEIGHBOURS) {
        const t = evaluate(best.storey, best.x + dx * step, best.y + dy * step)
        if (t.sse < best.sse) {
          best = t
          moved = true
        }
      }
    }
  }
  return best
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

/**
 * Trials on a finer grid around the fitted position, on its storey, that
 * are nearly as good: the coarse grid alone would round the uncertainty to
 * a metre. The grid spans the coarse region plus a cell, in at most 20
 * steps each way.
 */
function fineRegion(
  best: Trial,
  coarse: readonly Trial[],
  within: (t: Trial) => boolean,
  evaluate: (storey: number, x: number, y: number) => Trial,
): Trial[] {
  const reach =
    Math.max(
      0,
      ...coarse
        .filter((t) => t.storey === best.storey && within(t))
        .map((t) => Math.hypot(t.x - best.x, t.y - best.y)),
    ) + COARSE_STEP_M
  const step = Math.max(reach / 10, FINE_STEP_M * 5)
  const out: Trial[] = []
  for (let dx = -reach; dx <= reach + 1e-9; dx += step) {
    for (let dy = -reach; dy <= reach + 1e-9; dy += step) {
      const t = evaluate(best.storey, best.x + dx, best.y + dy)
      if (within(t)) out.push(t)
    }
  }
  return out
}

/** Whether a point is inside the floor's walls, from its area mask (0.1 m). */
function insideFloor(storey: Storey, x: number, y: number): boolean {
  const grid = gridForFloor(storey.floor)
  const col = Math.floor((x - grid.originX) / grid.cellM)
  const row = Math.floor((y - grid.originY) / grid.cellM)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false
  return floorAreaMask(storey.floor, grid)[row * grid.cols + col] === 1
}

/** The distance from a point to the nearest wall on a floor, in metres. */
function nearestWallM(storey: Storey, x: number, y: number): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const { a, b } of materialSegments(storey.floor)) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length2 = dx * dx + dy * dy
    const t =
      length2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / length2))
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy))
  }
  return nearest
}
