import {
  NEW_ACCESS_POINT_HEIGHT_M,
  type Band,
  type BandCalibration,
  type Plan,
} from '@signalplan/floorplan'
import { BAND_PROFILES } from './bands.ts'
import { DEFAULT_CELL_M, gridForFloor, RECEIVER_HEIGHT_M } from './coverage.ts'
import { indexedWallLoss, indexWalls, preparedWallLoss } from './crossings.ts'
import { floorAreaMask } from './floorArea.ts'
import {
  crossingLossDb,
  floorCrossing,
  prepareStack,
  type Storey,
} from './floors.ts'
import { regionBand } from './regions.ts'

/**
 * Locating an access point from where it was heard (D83, #143): given its
 * signal at three or more survey spots, the position and power that the
 * home's model fits best, and how sure that is.
 */

/** A source is located from readings at this many spots or more (D77). */
export const MIN_LOCATE_SPOTS = 3

/**
 * The least scatter in dB the fit assumes about the model, however well the
 * readings happen to agree: the held-out error left after calibrating the
 * synthetic homes of the Phase 7 gate (2.7–3.4 dB, D78). Readings can't be
 * trusted to agree more closely than the model can predict them.
 */
export const MODEL_SIGMA_DB = 3

/** The uncertainty is a 95 % region. */
export const CONFIDENCE = 0.95

/** The standard normal's 95th percentile, for `chiSquaredQuantile`. */
const Z_95 = 1.6448536

/**
 * The 95th percentile of χ² with k degrees of freedom, by Wilson and
 * Hilferty's approximation, k·(1 − 2/9k + z·√(2/9k))³: 0.9 % low at
 * k = 2 (5.94 against 5.99), 0.24 % at k = 5 and under 0.1 % from k = 10.
 * It's used from k = 2, since a fit needs three spots.
 */
export function chiSquaredQuantile95(k: number): number {
  const v = 2 / (9 * k)
  return k * (1 - v + Z_95 * Math.sqrt(v)) ** 3
}

/**
 * The most squared error, in dB², a position may leave and still be
 * nearly as good as the best, which left `bestSquares` over n readings.
 * Either test lets a position in:
 *
 * - **Close to the best:** the edge of a 95 % joint region in x and y, the
 *   power profiled out. With the scatter known that's χ²₂(95 %)·σ² above
 *   the best, χ²₂(95 %) = −2·ln(0.05) ≈ 5.99 and σ = MODEL_SIGMA_DB; with
 *   it estimated from the readings, 2·F(2, n − 3; 95 %)·σ̂², which allows
 *   for the estimate's own error. F with 2 degrees of freedom on top has
 *   the closed form ν/2·(α^(−2/ν) − 1), α = 0.05. The larger is used.
 * - **Not ruled out:** a squared error the model's scatter explains, below
 *   χ²ₙ₋₁(95 %)·MODEL_SIGMA_DB², n − 1 since the power is fitted. Walls
 *   with doors and windows in them make the error jump from place to
 *   place, so the best position can fit the noise far better than the true
 *   one does; this keeps the true one in the region all the same.
 */
export function regionLimit(n: number, bestSquares: number): number {
  const alpha = 1 - CONFIDENCE
  const sigma2 = MODEL_SIGMA_DB ** 2
  const nu = n - 3
  const scatter2 = nu > 0 ? bestSquares / nu : 0
  const f = nu > 0 ? (nu / 2) * (alpha ** (-2 / nu) - 1) : 0
  const close =
    bestSquares + Math.max(-2 * Math.log(alpha) * sigma2, 2 * f * scatter2)
  const explained = n > 1 ? chiSquaredQuantile95(n - 1) * sigma2 : 0
  return Math.max(close, explained)
}

/** Spacing of the first pass over candidate positions, in metres. */
export const COARSE_CELL_M = 1

/** Spacing of the pass that measures the uncertainty, in metres... */
const FINE_CELL_M = 0.1

/** ...widened so it never takes more than this many cells a side. */
const MAX_FINE_CELLS = 100

/**
 * How far past the floor's walls and the spots a neighbour may be, in
 * metres: a flat or house next door.
 */
export const OUTSIDE_REACH_M = 10

/** The weakest EIRP fitted, in dBm. The strongest is the region's limit. */
export const MIN_EIRP_DBM = 0

/** Where the refinement stops, in metres. */
const REFINE_STOP_M = 1e-3

/** How many separate minima of the first pass are refined. */
const REFINED_MINIMA = 3

/** Minima of the first pass closer than this are the same one. */
const SEPARATE_MINIMA_M = 2

/**
 * One spot where the source was heard: the spot's floor and position, and
 * its signal there in dBm, as a phone shows it.
 */
export interface Sighting {
  floorId: string
  x: number
  y: number
  dbm: number
}

export interface LocateOptions {
  /**
   * Calibrated values, as in `predictReadings`: the plan's own unless
   * others are passed, and `{}` gives the defaults.
   */
  calibration?: BandCalibration
  /** Height of the source above its floor, in metres. */
  heightM?: number
  /**
   * Whether the source may be outside the walls, as a neighbour's may. If
   * not, the first pass only tries positions inside a floor that has walls.
   */
  outside?: boolean
}

/** Where a source most likely is, with its power and how sure that is. */
export interface Location {
  floorId: string
  x: number
  y: number
  heightM: number
  /** Fitted EIRP in dBm, within 0 dBm and the region's limit. */
  eirpDbm: number
  /** The EIRP reached a limit, so the readings asked for more or less. */
  eirpAtLimit: boolean
  /** RMS of the readings less the fit's prediction, in dB. */
  rmsDb: number
  /**
   * The readings' scatter about the fit, on n − 3 degrees of freedom, or
   * MODEL_SIGMA_DB if that's more.
   */
  sigmaDb: number
  /**
   * The uncertainty, in metres: the furthest any position on this floor
   * nearly as good lies from this one (the 95 % region, `regionLimit`),
   * to within the grid that measured it.
   */
  uncertaintyM: number
  /** Other floors with positions nearly as good, in the plan's order. */
  otherFloorIds: string[]
  /** The position isn't inside the floor's walls. */
  outside: boolean
  /** Distance to the nearest wall on its floor, in metres; ∞ with none. */
  nearestWallM: number
  /** How many sightings the fit used. */
  spots: number
}

/**
 * A located source's signal at a sighting, for any EIRP: EIRP + `gainDb`.
 * `gainDb` is −[PL(1 m) + 10·n·log10(d) + losses] + the device offset.
 */
type Gains = (floor: number, x: number, y: number) => Float64Array

/**
 * The position and power that best fit `sightings`, by least squares on
 * dB: every floor is tried on a grid every COARSE_CELL_M, the power solved
 * in closed form at each, and the best few minima refined with a pattern
 * search. The model is the heatmap's (`predictReadings`): 3D distance from
 * a source `heightM` above its floor to a receiver 1 m above the spot's,
 * the walls and slabs between, calibrated where the plan is. The device
 * offset of a calibration is taken off, so the EIRP is the source's own.
 *
 * The refinement and the uncertainty work paths out from the spots, which
 * gives the same losses faster; the result is then worked out exactly as
 * `predictReadings` would. Positions nearly as good are those whose squared
 * error is within `regionLimit`. Undefined with sightings at fewer than
 * MIN_LOCATE_SPOTS spots on the plan's floors.
 */
export function locateSource(
  plan: Plan,
  band: Band,
  sightings: readonly Sighting[],
  options: LocateOptions = {},
): Location | undefined {
  const calibration = options.calibration ?? plan.calibration?.[band] ?? {}
  const heightM = options.heightM ?? NEW_ACCESS_POINT_HEIGHT_M
  const outsideAllowed = options.outside ?? false
  const stack = prepareStack(plan, band, calibration)
  const storeyOf = new Map(stack.map((storey, i) => [storey.floor.id, i]))
  const used = sightings.filter((s) => storeyOf.has(s.floorId))
  const spots = new Set(used.map((s) => `${s.floorId} ${s.x} ${s.y}`))
  if (spots.size < MIN_LOCATE_SPOTS) return undefined

  const profile = BAND_PROFILES[band]
  const exponent = calibration.pathLossExponent ?? profile.pathLossExponent
  const offsetDb = calibration.deviceOffsetDb ?? 0
  const maxEirp = regionBand(plan.region, band).maxEirpDbm
  const measured = Float64Array.from(used, (s) => s.dbm)

  const gainDb = (loss: number, distance: number) =>
    -profile.referenceLossDb -
    10 * exponent * Math.log10(Math.max(distance, 1)) -
    loss +
    offsetDb

  // Exactly as `predictReadings` works a path out, from the source.
  const exactGains: Gains = (from, x, y) => {
    const out = new Float64Array(used.length)
    const apZ = stack[from]!.floor.elevationM + heightM
    used.forEach((s, i) => {
      const here = storeyOf.get(s.floorId)!
      let loss: number
      let dz: number
      if (from === here) {
        loss = preparedWallLoss(stack[here]!.walls, x, y, s.x, s.y)
        dz = heightM - RECEIVER_HEIGHT_M
      } else {
        const receiverZ = stack[here]!.floor.elevationM + RECEIVER_HEIGHT_M
        const crossing = floorCrossing(stack, from, apZ, here, receiverZ)
        loss = crossingLossDb(crossing, x, y, s.x, s.y)
        dz = apZ - receiverZ
      }
      out[i] = gainDb(loss, Math.hypot(s.x - x, s.y - y, dz))
    })
    return out
  }

  // The best power for some gains, and the squared error it leaves.
  const fit = (gains: Float64Array) => {
    let sum = 0
    for (let i = 0; i < gains.length; i++) sum += measured[i]! - gains[i]!
    const free = sum / gains.length
    const eirp = Math.min(Math.max(free, MIN_EIRP_DBM), maxEirp)
    let squares = 0
    for (let i = 0; i < gains.length; i++) {
      const r = measured[i]! - gains[i]! - eirp
      squares += r * r
    }
    return { eirp, squares, atLimit: eirp !== free }
  }

  // Paths are worked out from the spots, whose walls are indexed once
  // (D56); a path's loss is the same either way.
  const pathsTo = (from: number) => {
    const apZ = stack[from]!.floor.elevationM + heightM
    return used.map((s) => {
      const here = storeyOf.get(s.floorId)!
      const receiverZ = stack[here]!.floor.elevationM + RECEIVER_HEIGHT_M
      const dz = apZ - receiverZ
      return here === from
        ? { s, dz, index: indexWalls(stack[here]!.walls, s.x, s.y) }
        : {
            s,
            dz,
            crossing: floorCrossing(stack, here, receiverZ, from, apZ, s),
          }
    })
  }
  type Paths = ReturnType<typeof pathsTo>
  const gains = new Float64Array(used.length)
  const squaresAt = (paths: Paths, x: number, y: number) => {
    paths.forEach((path, i) => {
      const { s } = path
      const loss =
        'index' in path
          ? indexedWallLoss(path.index, s.x, s.y, x, y)
          : crossingLossDb(path.crossing, s.x, s.y, x, y)
      gains[i] = gainDb(loss, Math.hypot(x - s.x, y - s.y, path.dz))
    })
    return fit(gains).squares
  }

  // First pass: every floor on a coarse grid.
  const candidates: { floor: number; x: number; y: number; squares: number }[] =
    []
  const floorPaths = stack.map((_, from) => pathsTo(from))
  stack.forEach((storey, from) => {
    const grid = gridForFloor(
      storey.floor,
      COARSE_CELL_M,
      used.filter((s) => s.floorId === storey.floor.id),
    )
    const pad = outsideAllowed ? Math.ceil(OUTSIDE_REACH_M / grid.cellM) : 0
    const inside =
      outsideAllowed || storey.floor.walls.length === 0
        ? undefined
        : floorAreaMask(storey.floor, grid)
    const paths = floorPaths[from]!
    for (let row = -pad; row < grid.rows + pad; row++) {
      const y = grid.originY + (row + 0.5) * grid.cellM
      for (let col = -pad; col < grid.cols + pad; col++) {
        if (inside && !inside[row * grid.cols + col]) continue
        const x = grid.originX + (col + 0.5) * grid.cellM
        candidates.push({ floor: from, x, y, squares: squaresAt(paths, x, y) })
      }
    }
  })
  if (candidates.length === 0) return undefined

  // Refine the best few separate minima, each on its own floor.
  const sorted = [...candidates].sort((a, b) => a.squares - b.squares)
  const starts: typeof candidates = []
  for (const c of sorted) {
    if (starts.length === REFINED_MINIMA) break
    const near = starts.some(
      (s) =>
        s.floor === c.floor &&
        Math.hypot(s.x - c.x, s.y - c.y) < SEPARATE_MINIMA_M,
    )
    if (!near) starts.push(c)
  }
  let best: { floor: number; x: number; y: number; squares: number } | undefined
  for (const start of starts) {
    const paths = floorPaths[start.floor]!
    const refined = refine(start, (x, y) => squaresAt(paths, x, y))
    if (!best || refined.squares < best.squares) best = refined
  }
  const { floor: from, x, y, squares } = best!
  const result = fit(exactGains(from, x, y))
  const n = used.length

  const rmsDb = Math.sqrt(result.squares / n)
  // Three unknowns are fitted, so the scatter is estimated on n − 3.
  const scatter = n > 3 ? Math.sqrt(squares / (n - 3)) : 0
  const sigmaDb = Math.max(scatter, MODEL_SIGMA_DB)
  const within = regionLimit(n, squares)
  const otherFloors = new Set<number>()
  let minX = x
  let maxX = x
  let minY = y
  let maxY = y
  for (const c of candidates) {
    if (c.squares > within) continue
    if (c.floor !== from) {
      otherFloors.add(c.floor)
      continue
    }
    minX = Math.min(minX, c.x)
    maxX = Math.max(maxX, c.x)
    minY = Math.min(minY, c.y)
    maxY = Math.max(maxY, c.y)
  }
  // The first pass is too coarse to measure a small region, so it's
  // measured again on a finer grid over the cells it found, and a cell
  // more each way.
  minX -= COARSE_CELL_M
  minY -= COARSE_CELL_M
  maxX += COARSE_CELL_M
  maxY += COARSE_CELL_M
  const cell = Math.max(
    FINE_CELL_M,
    Math.max(maxX - minX, maxY - minY) / MAX_FINE_CELLS,
  )
  const paths = floorPaths[from]!
  let furthest = 0
  for (let fy = minY + cell / 2; fy < maxY; fy += cell) {
    for (let fx = minX + cell / 2; fx < maxX; fx += cell) {
      const d = Math.hypot(fx - x, fy - y)
      if (d > furthest && squaresAt(paths, fx, fy) <= within) furthest = d
    }
  }
  const uncertaintyM = furthest + cell / Math.SQRT2

  const storey = stack[from]!
  return {
    floorId: storey.floor.id,
    x,
    y,
    heightM,
    eirpDbm: result.eirp,
    eirpAtLimit: result.atLimit,
    rmsDb,
    sigmaDb,
    uncertaintyM,
    otherFloorIds: plan.floors
      .map((f) => f.id)
      .filter((id) => [...otherFloors].some((i) => stack[i]!.floor.id === id)),
    outside: isOutside(storey, x, y),
    nearestWallM: nearestWallM(storey, x, y),
    spots: n,
  }
}

/**
 * A pattern search from a start: tries the eight neighbours a step away,
 * moves to the best if it's better, and halves the step when none is.
 */
function refine<T extends { x: number; y: number; squares: number }>(
  start: T,
  cost: (x: number, y: number) => number,
): T {
  let { x, y } = start
  let current = cost(x, y)
  let step = COARSE_CELL_M / 2
  while (step >= REFINE_STOP_M) {
    let bestX = x
    let bestY = y
    let bestCost = current
    for (const [dx, dy] of NEIGHBOURS) {
      const value = cost(x + dx! * step, y + dy! * step)
      if (value < bestCost) {
        bestCost = value
        bestX = x + dx! * step
        bestY = y + dy! * step
      }
    }
    if (bestCost < current) {
      x = bestX
      y = bestY
      current = bestCost
    } else {
      step /= 2
    }
  }
  return { ...start, x, y, squares: current }
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

function isOutside(storey: Storey, x: number, y: number): boolean {
  const { floor } = storey
  if (floor.walls.length === 0) return false
  const grid = gridForFloor(floor, DEFAULT_CELL_M)
  const col = Math.floor((x - grid.originX) / grid.cellM)
  const row = Math.floor((y - grid.originY) / grid.cellM)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return true
  return floorAreaMask(floor, grid)[row * grid.cols + col] === 0
}

function nearestWallM(storey: Storey, x: number, y: number): number {
  const w = storey.walls
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < w.count; i++) {
    const ax = w.ax[i]!
    const ay = w.ay[i]!
    const sx = w.sx[i]!
    const sy = w.sy[i]!
    const lengthSq = sx * sx + sy * sy
    const t =
      lengthSq > 0
        ? Math.min(Math.max(((x - ax) * sx + (y - ay) * sy) / lengthSq, 0), 1)
        : 0
    nearest = Math.min(nearest, Math.hypot(x - ax - t * sx, y - ay - t * sy))
  }
  return nearest
}

/**
 * Where one of the plan's access points was heard on a band: each survey
 * reading of it, at its spot (D71, D82). Readings on a band the access point
 * has no radio for count too, since they were measured.
 */
export function accessPointSightings(
  plan: Plan,
  apId: string,
  band: Band,
): Sighting[] {
  return plan.floors.flatMap((floor) =>
    (floor.surveySpots ?? []).flatMap((spot) =>
      spot.readings
        .filter((r) => r.apId === apId && r.band === band)
        .map((r) => ({ floorId: floor.id, x: spot.x, y: spot.y, dbm: r.dbm })),
    ),
  )
}

/**
 * Where a device was heard on a band by scans at survey spots (D82): at
 * each spot, the mean power of its BSSIDs heard there, each weighted by
 * how many scans it holds, as D72 averages readings.
 */
export function bssidSightings(
  plan: Plan,
  bssids: readonly string[],
  band: Band,
): Sighting[] {
  const wanted = new Set(bssids)
  return plan.floors.flatMap((floor) =>
    (floor.surveySpots ?? []).flatMap((spot) => {
      let mw = 0
      let weight = 0
      for (const r of spot.neighbourReadings ?? []) {
        if (r.band !== band || !wanted.has(r.bssid)) continue
        const scans = r.scans ?? 1
        mw += scans * 10 ** (r.dbm / 10)
        weight += scans
      }
      return weight > 0
        ? [
            {
              floorId: floor.id,
              x: spot.x,
              y: spot.y,
              dbm: 10 * Math.log10(mw / weight),
            },
          ]
        : []
    }),
  )
}
