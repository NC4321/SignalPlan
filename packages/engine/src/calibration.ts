import {
  DEFAULT_FLOOR_MATERIAL,
  FLOOR_MATERIALS,
  materialSegments,
  WALL_MATERIALS,
  type Band,
  type BandCalibration,
  type FloorMaterial,
  type MaterialSegment,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import { BAND_PROFILES } from './bands.ts'
import { boundedLeastSquares } from './boundedLeastSquares.ts'
import {
  DEVICE_OFFSET_LIMITS_DB,
  EXPONENT_LIMITS,
  floorLimitsDb,
  wallLimitsDb,
} from './calibrationLimits.ts'
import { DEFAULT_CELL_M, gridForFloor, RECEIVER_HEIGHT_M } from './coverage.ts'
import { crossings } from './crossings.ts'
import { floorRooms, type Room } from './floorArea.ts'
import { floorCrossing, inHole, prepareStack } from './floors.ts'
import {
  FLOOR_LOSS_DB,
  floorLossAtDb,
  floorLossTable,
  MATERIAL_LOSS_DB,
} from './materials.ts'

/**
 * Calibrated values live in the plan (D76), so everything that reads the
 * plan follows them.
 */
export type { BandCalibration, Calibration } from '@signalplan/floorplan'

/**
 * Fitting is offered from this many spots with readings on the band (D75),
 * counting only spots at least `MIN_SPOT_SEPARATION_M` apart (D101).
 */
export const MIN_SPOTS = 10

/**
 * Spots closer than this on the same floor count as one place towards
 * `MIN_SPOTS` (D101): within a metre the path to each access point is the
 * same to the model, so a second spot there adds a repeat, not a new
 * position.
 */
export const MIN_SPOT_SEPARATION_M = 1

/**
 * The spread of the readings' distances from their access points, as the
 * standard deviation of 10·log10 d in dB, below which the fit isn't offered
 * (D101). The exponent and the device offset are only told apart by how
 * readings change with distance: if every reading is at about the same
 * distance, any n fits as well as any other once the offset makes up the
 * difference. At 1.5 dB, moving n across its whole range (1.47–2.39) moves
 * the predictions by under 1.4 dB RMS relative to each other, less than
 * half the 3 dB a phone's readings scatter by. Surveys with a spot in each
 * room spread 2.2–2.7 dB.
 */
export const MIN_DISTANCE_SPREAD_DB = 1.5

/** ...and spots in at least this share of the rooms on each floor. */
export const MIN_ROOM_SHARE = 0.5

/** Enclosed areas smaller than this, such as cupboards, aren't rooms. */
export const MIN_ROOM_AREA_M2 = 2

/**
 * A material is fitted only if at least this many readings' paths cross it,
 * from at least this many spots; otherwise it keeps its default (D75).
 */
export const MIN_CROSSING_READINGS = 5
export const MIN_CROSSING_SPOTS = 3

/**
 * One reading and its path, in the pieces the fit adjusts (D75). With the
 * default values it gives exactly `predictReadings`' prediction.
 */
export interface SurveyPath {
  spotId: string
  floorId: string
  /** Where the reading is in its spot's list. */
  index: number
  apId: string
  measuredDbm: number
  /** EIRP − PL(1 m), in dBm. */
  baseDbm: number
  /** log10 of the 3D distance in metres, 0 within 1 m. */
  logDistance: number
  /**
   * The wall crossings: at each, the different materials the path touches
   * there. The lossiest counts, as in `wallLoss`.
   */
  crossings: WallMaterial[][]
  /** Default loss of the slabs crossed, at the path's angle, by material. */
  slabLossDb: Partial<Record<FloorMaterial, number>>
}

/**
 * Every reading on a band, as `predictReadings` works each out: a receiver
 * 1 m above the spot's floor, 3D distance, this floor's walls, and from
 * another floor the slabs and each storey's walls along its stretch.
 */
export function surveyPaths(plan: Plan, band: Band): SurveyPath[] {
  // Only the geometry is used, but the fit always starts from the defaults,
  // whatever the plan is calibrated to.
  const stack = prepareStack(plan, band, {})
  const storeyOf = new Map(stack.map((storey, i) => [storey.floor.id, i]))
  const segments = stack.map((storey) => materialSegments(storey.floor))
  const aps = new Map(plan.accessPoints.map((ap) => [ap.id, ap]))
  const profile = BAND_PROFILES[band]
  const paths: SurveyPath[] = []
  for (const floor of plan.floors) {
    for (const spot of floor.surveySpots ?? []) {
      spot.readings.forEach((reading, index) => {
        if (reading.band !== band) return
        const ap = aps.get(reading.apId)
        const radio = ap?.radios.find((r) => r.band === band)
        const here = storeyOf.get(floor.id)
        const from = ap && storeyOf.get(ap.floorId)
        if (!ap || !radio || here === undefined || from === undefined) return
        const walls: WallMaterial[][] = []
        const addWalls = (
          wallSegments: readonly MaterialSegment[],
          x0: number,
          y0: number,
          x1: number,
          y1: number,
        ) => {
          for (const crossing of crossings(
            wallSegments,
            { x: x0, y: y0 },
            { x: x1, y: y1 },
          )) {
            walls.push([...new Set(crossing.segments.map((s) => s.material))])
          }
        }
        const slabLossDb: Partial<Record<FloorMaterial, number>> = {}
        let dz: number
        if (from === here) {
          addWalls(segments[here]!, ap.x, ap.y, spot.x, spot.y)
          dz = ap.heightM - RECEIVER_HEIGHT_M
        } else {
          const apZ = stack[from]!.floor.elevationM + ap.heightM
          const receiverZ = floor.elevationM + RECEIVER_HEIGHT_M
          const crossing = floorCrossing(stack, from, apZ, here, receiverZ)
          const dx = spot.x - ap.x
          const dy = spot.y - ap.y
          const across = Math.hypot(dx, dy)
          for (const { storey, t } of crossing.slabs) {
            const { holes, floor: slabFloor } = stack[storey]!
            if (holes && inHole(holes, ap.x + t * dx, ap.y + t * dy)) continue
            const material = slabFloor.material ?? DEFAULT_FLOOR_MATERIAL
            const loss = floorLossAtDb(
              floorLossTable(band, material),
              across,
              crossing.riseM,
            )
            slabLossDb[material] = (slabLossDb[material] ?? 0) + loss
          }
          const step = here > from ? 1 : -1
          crossing.stretches.forEach(({ fromT, toT }, k) => {
            if (toT <= fromT) return
            addWalls(
              segments[from + k * step]!,
              ap.x + fromT * dx,
              ap.y + fromT * dy,
              ap.x + toT * dx,
              ap.y + toT * dy,
            )
          })
          dz = apZ - receiverZ
        }
        const distance = Math.max(
          Math.hypot(spot.x - ap.x, spot.y - ap.y, dz),
          1,
        )
        paths.push({
          spotId: spot.id,
          floorId: floor.id,
          index,
          apId: ap.id,
          measuredDbm: reading.dbm,
          baseDbm:
            (radio.txPowerDbm ?? profile.defaultTxPowerDbm) -
            profile.referenceLossDb,
          logDistance: Math.log10(distance),
          crossings: walls,
          slabLossDb,
        })
      })
    }
  }
  return paths
}

/** The values the fit works with: the model's, plus a device offset. */
export interface ModelValues {
  exponent: number
  offsetDb: number
  wallLossDb: Record<WallMaterial, number>
  /** Each floor's loss as a multiple of its default, at every angle. */
  floorScale: Record<FloorMaterial, number>
}

export function defaultValues(band: Band): ModelValues {
  return {
    exponent: BAND_PROFILES[band].pathLossExponent,
    offsetDb: 0,
    wallLossDb: { ...MATERIAL_LOSS_DB[band] },
    floorScale: Object.fromEntries(
      FLOOR_MATERIALS.map((m) => [m, 1]),
    ) as Record<FloorMaterial, number>,
  }
}

/**
 * How many of a path's crossings each wall material counts at, with these
 * losses: at a crossing touching several, the lossiest.
 */
function wallCounts(
  path: SurveyPath,
  wallLossDb: Readonly<Record<WallMaterial, number>>,
): Map<WallMaterial, number> {
  const counts = new Map<WallMaterial, number>()
  for (const materials of path.crossings) {
    let best = materials[0]!
    for (const m of materials) if (wallLossDb[m] > wallLossDb[best]) best = m
    counts.set(best, (counts.get(best) ?? 0) + 1)
  }
  return counts
}

/** The signal predicted for a path with these values, in dBm. */
export function predictPath(path: SurveyPath, values: ModelValues): number {
  let loss = 0
  for (const [material, count] of wallCounts(path, values.wallLossDb)) {
    loss += count * values.wallLossDb[material]
  }
  for (const material of FLOOR_MATERIALS) {
    loss += (path.slabLossDb[material] ?? 0) * values.floorScale[material]
  }
  return (
    path.baseDbm -
    10 * values.exponent * path.logDistance -
    loss +
    values.offsetDb
  )
}

/** Why a material crossed by readings kept its default. */
export type KeptReason = 'too-few-paths' | 'no-limits'

/** How many readings, and from how many spots, cross each material. */
interface Support {
  readings: number
  spots: Set<string>
}

function support<M extends string>(
  paths: readonly SurveyPath[],
  crossed: (path: SurveyPath) => Iterable<M>,
): Map<M, Support> {
  const result = new Map<M, Support>()
  for (const path of paths) {
    for (const material of new Set(crossed(path))) {
      let entry = result.get(material)
      if (!entry) {
        entry = { readings: 0, spots: new Set() }
        result.set(material, entry)
      }
      entry.readings++
      entry.spots.add(path.spotId)
    }
  }
  return result
}

const enough = (entry: Support | undefined) =>
  entry !== undefined &&
  entry.readings >= MIN_CROSSING_READINGS &&
  entry.spots.size >= MIN_CROSSING_SPOTS

const wallsCrossed = (band: Band) => (path: SurveyPath) =>
  wallCounts(path, MATERIAL_LOSS_DB[band]).keys()

const floorsCrossed = (path: SurveyPath) =>
  FLOOR_MATERIALS.filter((m) => (path.slabLossDb[m] ?? 0) > 0)

/** Which materials the fit adjusts, and how much each is crossed. */
interface FitPlan {
  walls: WallMaterial[]
  floors: FloorMaterial[]
  wallSupport: Map<WallMaterial, Support>
  floorSupport: Map<FloorMaterial, Support>
}

function planFit(paths: readonly SurveyPath[], band: Band): FitPlan {
  // Crossings count by the lossiest material at default values, so which
  // materials are fitted doesn't depend on the fit.
  const wallSupport = support(paths, wallsCrossed(band))
  const floorSupport = support(paths, floorsCrossed)
  return {
    walls: WALL_MATERIALS.filter(
      (m) => wallLimitsDb(band, m) && enough(wallSupport.get(m)),
    ),
    floors: FLOOR_MATERIALS.filter(
      (m) => floorLimitsDb(band, m) && enough(floorSupport.get(m)),
    ),
    wallSupport,
    floorSupport,
  }
}

/** A crossing touching several materials: which one counts, per path. */
const winnersKey = (
  paths: readonly SurveyPath[],
  wallLossDb: Readonly<Record<WallMaterial, number>>,
) =>
  paths
    .map((path) =>
      [...wallCounts(path, wallLossDb)].map(([m, n]) => `${m}${n}`).join(),
    )
    .join(';')

/**
 * Bounded least squares over the exponent, the device offset and the
 * materials `plan` names, each within its limits (D75). The model is linear
 * in all of them once it's known which material counts where a crossing
 * touches several; if the fit changes that, it's fitted again, up to five
 * times.
 */
function fitValues(
  paths: readonly SurveyPath[],
  band: Band,
  plan: FitPlan,
): ModelValues {
  const values = defaultValues(band)
  if (paths.length === 0) return values
  const wallLimits = plan.walls.map((m) => wallLimitsDb(band, m)!)
  const floorLimits = plan.floors.map((m) => {
    const [lo, hi] = floorLimitsDb(band, m)!
    const headOn = FLOOR_LOSS_DB[band][m]
    return [lo / headOn, hi / headOn] as const
  })
  const lower = [
    EXPONENT_LIMITS[0],
    DEVICE_OFFSET_LIMITS_DB[0],
    ...wallLimits.map(([lo]) => lo),
    ...floorLimits.map(([lo]) => lo),
  ]
  const upper = [
    EXPONENT_LIMITS[1],
    DEVICE_OFFSET_LIMITS_DB[1],
    ...wallLimits.map(([, hi]) => hi),
    ...floorLimits.map(([, hi]) => hi),
  ]
  const freeWalls = new Set(plan.walls)
  const freeFloors = new Set(plan.floors)
  // Each round's values are judged with their own winners, and the best
  // round is kept, in case the winners never settle.
  const squaredError = (v: ModelValues) =>
    paths.reduce((sum, p) => sum + (predictPath(p, v) - p.measuredDbm) ** 2, 0)
  let best = values
  let bestError = Number.POSITIVE_INFINITY
  let key = winnersKey(paths, values.wallLossDb)
  for (let round = 0; round < 5; round++) {
    const rows: number[][] = []
    const b: number[] = []
    for (const path of paths) {
      const counts = wallCounts(path, values.wallLossDb)
      // Fixed materials' loss moves to the right-hand side.
      let fixed = 0
      for (const [material, count] of counts) {
        if (!freeWalls.has(material))
          fixed += count * values.wallLossDb[material]
      }
      for (const material of FLOOR_MATERIALS) {
        if (!freeFloors.has(material)) {
          fixed +=
            (path.slabLossDb[material] ?? 0) * values.floorScale[material]
        }
      }
      rows.push([
        -10 * path.logDistance,
        1,
        ...plan.walls.map((m) => -(counts.get(m) ?? 0)),
        ...plan.floors.map((m) => -(path.slabLossDb[m] ?? 0)),
      ])
      b.push(path.measuredDbm - path.baseDbm + fixed)
    }
    const start = [
      values.exponent,
      values.offsetDb,
      ...plan.walls.map((m) => values.wallLossDb[m]),
      ...plan.floors.map((m) => values.floorScale[m]),
    ]
    const x = boundedLeastSquares(rows, b, lower, upper, start)
    values.exponent = x[0]!
    values.offsetDb = x[1]!
    plan.walls.forEach((m, i) => (values.wallLossDb[m] = x[2 + i]!))
    plan.floors.forEach(
      (m, i) => (values.floorScale[m] = x[2 + plan.walls.length + i]!),
    )
    const error = squaredError(values)
    if (error < bestError) {
      bestError = error
      best = {
        ...values,
        wallLossDb: { ...values.wallLossDb },
        floorScale: { ...values.floorScale },
      }
    }
    const next = winnersKey(paths, values.wallLossDb)
    if (next === key) break
    key = next
  }
  return best
}

/** A fitted number next to its default and limits. */
export interface FittedValue {
  defaultValue: number
  value: number
  limits: readonly [number, number]
  /** The fit stopped at a limit. */
  atLimit: boolean
}

/** A material that readings cross, fitted or kept at its default. */
export interface MaterialFit<M extends string> {
  material: M
  defaultDb: number
  /** Head-on for a floor. The default if it wasn't fitted. */
  valueDb: number
  /** Undefined when the material has too few measurements to be fitted. */
  limitsDb: readonly [number, number] | undefined
  /** Readings whose paths cross it, and from how many spots. */
  readings: number
  spots: number
  /** Why it kept its default, or undefined when fitted. */
  kept: KeptReason | undefined
  atLimit: boolean
}

/** Mean and root mean square of predicted − measured, in dB. */
export interface ErrorStats {
  count: number
  meanDb: number
  rmsDb: number
}

/** One reading's error before and after, held out (D75). */
export interface HeldOutReading {
  spotId: string
  floorId: string
  index: number
  apId: string
  /** Predicted − measured with the defaults and no device offset. */
  beforeDb: number
  /** The same by a fit that didn't use this reading's spot. */
  afterDb: number
  /**
   * The same fit without its device offset: what the error report shows
   * once only the home's values are applied.
   */
  afterWithoutOffsetDb: number
}

/** Parts of the home that need spots before a fit is offered (D75). */
export interface FloorReadiness {
  floorId: string
  /** Rooms of at least `MIN_ROOM_AREA_M2`. */
  rooms: number
  roomsWithSpots: number
  roomsNeeded: number
  /** The rooms without a spot, each with a point inside it. */
  emptyRooms: Room[]
}

export interface SurveyReadiness {
  /** Spots with a reading on the band that the model can compare. */
  spots: number
  /**
   * Of those, how many are at separate places, at least
   * `MIN_SPOT_SEPARATION_M` from each other (D101). These count towards
   * `spotsNeeded`.
   */
  separateSpots: number
  spotsNeeded: number
  /**
   * The standard deviation of 10·log10 of the readings' distances from
   * their access points, in dB, and the least the fit needs (D101).
   */
  distanceSpreadDb: number
  distanceSpreadNeededDb: number
  /** Each floor with rooms, in the plan's order. */
  floors: FloorReadiness[]
  ready: boolean
}

/**
 * Whether there are enough spots, spread widely enough, to fit a band:
 * `MIN_SPOTS` spots with readings on it at separate places, and on every
 * floor with rooms, spots in at least `MIN_ROOM_SHARE` of them (D75), and
 * readings at a spread of distances from the access points (D101). Rooms
 * are the floor's enclosed areas, with doors and windows closed
 * (`floorRooms`).
 */
export function surveyReadiness(
  plan: Plan,
  paths: readonly SurveyPath[],
): SurveyReadiness {
  const spotIds = new Set(paths.map((p) => p.spotId))
  const floors: FloorReadiness[] = []
  let separateSpots = 0
  for (const floor of plan.floors) {
    // Spots on the band, each counted unless it's within the separation of
    // one already counted on this floor.
    const places: { x: number; y: number }[] = []
    for (const spot of floor.surveySpots ?? []) {
      if (!spotIds.has(spot.id)) continue
      const near = places.some(
        (p) => Math.hypot(p.x - spot.x, p.y - spot.y) < MIN_SPOT_SEPARATION_M,
      )
      if (!near) places.push(spot)
    }
    separateSpots += places.length

    const grid = gridForFloor(floor, DEFAULT_CELL_M)
    const { rooms, roomOf } = floorRooms(floor, grid)
    const counted = rooms.flatMap((room, i) =>
      room.areaM2 >= MIN_ROOM_AREA_M2 ? [i] : [],
    )
    if (counted.length === 0) continue
    const visited = new Set<number>()
    for (const spot of floor.surveySpots ?? []) {
      if (!spotIds.has(spot.id)) continue
      const col = Math.floor((spot.x - grid.originX) / grid.cellM)
      const row = Math.floor((spot.y - grid.originY) / grid.cellM)
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue
      const room = roomOf[row * grid.cols + col]!
      if (room >= 0) visited.add(room)
    }
    floors.push({
      floorId: floor.id,
      rooms: counted.length,
      roomsWithSpots: counted.filter((i) => visited.has(i)).length,
      roomsNeeded: Math.ceil(counted.length * MIN_ROOM_SHARE),
      emptyRooms: counted.filter((i) => !visited.has(i)).map((i) => rooms[i]!),
    })
  }
  const distanceSpreadDb = standardDeviation(
    paths.map((p) => 10 * p.logDistance),
  )
  return {
    spots: spotIds.size,
    separateSpots,
    spotsNeeded: MIN_SPOTS,
    distanceSpreadDb,
    distanceSpreadNeededDb: MIN_DISTANCE_SPREAD_DB,
    floors,
    ready:
      separateSpots >= MIN_SPOTS &&
      distanceSpreadDb >= MIN_DISTANCE_SPREAD_DB &&
      floors.every((f) => f.roomsWithSpots >= f.roomsNeeded),
  }
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((total, v) => total + v, 0) / values.length
  const squares = values.reduce((total, v) => total + (v - mean) ** 2, 0)
  return Math.sqrt(squares / values.length)
}

/** The fit on one band, once there are enough spots. */
export interface BandFit {
  exponent: FittedValue
  deviceOffsetDb: FittedValue
  /** Materials the readings cross, in the order of the schema's lists. */
  walls: MaterialFit<WallMaterial>[]
  floors: MaterialFit<FloorMaterial>[]
  /** The fitted values, ready to save to the plan. */
  calibration: BandCalibration
  /**
   * Held out by spot: each spot predicted by a fit without it. Before is
   * the defaults with no offset; after includes the fitted device offset,
   * which judges the fit; `afterWithoutOffset` leaves it out, as the saved
   * calibration does. n and the offset trade off, so that one can be worse
   * than before.
   */
  before: ErrorStats
  after: ErrorStats
  afterWithoutOffset: ErrorStats
  heldOut: HeldOutReading[]
}

export interface BandCalibrationResult {
  band: Band
  readiness: SurveyReadiness
  /** Undefined until the survey is ready. */
  fit: BandFit | undefined
}

function stats(errors: readonly number[]): ErrorStats {
  const count = errors.length
  if (count === 0) return { count, meanDb: 0, rmsDb: 0 }
  const sum = errors.reduce((total, e) => total + e, 0)
  const squares = errors.reduce((total, e) => total + e * e, 0)
  return { count, meanDb: sum / count, rmsDb: Math.sqrt(squares / count) }
}

const atLimit = (value: number, [lo, hi]: readonly [number, number]) =>
  value <= lo + 1e-6 || value >= hi - 1e-6

/**
 * Fits one band to the plan's survey readings (D75): bounded least squares
 * over the loss of each wall and floor material that enough readings'
 * paths cross, the path loss exponent and one device offset, each within
 * limits from primary sources (`calibrationLimits.ts`). The error before
 * and after is held out by spot: each spot's readings are predicted by a
 * fit to the other spots, so a lower number after means a better model,
 * not one that has learned the readings.
 */
export function calibrateBand(plan: Plan, band: Band): BandCalibrationResult {
  const paths = surveyPaths(plan, band)
  const readiness = surveyReadiness(plan, paths)
  if (!readiness.ready) return { band, readiness, fit: undefined }

  const fitPlan = planFit(paths, band)
  const values = fitValues(paths, band, fitPlan)
  const defaults = defaultValues(band)

  const heldOut: HeldOutReading[] = []
  const spotIds = [...new Set(paths.map((p) => p.spotId))]
  for (const spotId of spotIds) {
    const rest = paths.filter((p) => p.spotId !== spotId)
    const restValues = fitValues(rest, band, planFit(rest, band))
    for (const path of paths) {
      if (path.spotId !== spotId) continue
      heldOut.push({
        spotId,
        floorId: path.floorId,
        index: path.index,
        apId: path.apId,
        beforeDb: predictPath(path, defaults) - path.measuredDbm,
        afterDb: predictPath(path, restValues) - path.measuredDbm,
        afterWithoutOffsetDb:
          predictPath(path, { ...restValues, offsetDb: 0 }) - path.measuredDbm,
      })
    }
  }

  const materialFit = <M extends string>(
    material: M,
    defaultDb: number,
    valueDb: number,
    limitsDb: readonly [number, number] | undefined,
    entry: Support,
    fitted: boolean,
  ): MaterialFit<M> => ({
    material,
    defaultDb,
    valueDb,
    limitsDb,
    readings: entry.readings,
    spots: entry.spots.size,
    kept: fitted ? undefined : limitsDb ? 'too-few-paths' : 'no-limits',
    atLimit: fitted && limitsDb !== undefined && atLimit(valueDb, limitsDb),
  })
  const walls = WALL_MATERIALS.flatMap((m) => {
    const entry = fitPlan.wallSupport.get(m)
    if (!entry) return []
    return [
      materialFit(
        m,
        MATERIAL_LOSS_DB[band][m],
        values.wallLossDb[m],
        wallLimitsDb(band, m),
        entry,
        fitPlan.walls.includes(m),
      ),
    ]
  })
  const floors = FLOOR_MATERIALS.flatMap((m) => {
    const entry = fitPlan.floorSupport.get(m)
    if (!entry) return []
    const headOn = FLOOR_LOSS_DB[band][m]
    return [
      materialFit(
        m,
        headOn,
        headOn * values.floorScale[m],
        floorLimitsDb(band, m),
        entry,
        fitPlan.floors.includes(m),
      ),
    ]
  })

  const calibration: BandCalibration = {
    pathLossExponent: values.exponent,
    deviceOffsetDb: values.offsetDb,
  }
  if (fitPlan.walls.length > 0) {
    calibration.wallLossDb = Object.fromEntries(
      fitPlan.walls.map((m) => [m, values.wallLossDb[m]]),
    )
  }
  if (fitPlan.floors.length > 0) {
    calibration.floorLossDb = Object.fromEntries(
      fitPlan.floors.map((m) => [
        m,
        FLOOR_LOSS_DB[band][m] * values.floorScale[m],
      ]),
    )
  }

  return {
    band,
    readiness,
    fit: {
      exponent: {
        defaultValue: defaults.exponent,
        value: values.exponent,
        limits: EXPONENT_LIMITS,
        atLimit: atLimit(values.exponent, EXPONENT_LIMITS),
      },
      deviceOffsetDb: {
        defaultValue: 0,
        value: values.offsetDb,
        limits: DEVICE_OFFSET_LIMITS_DB,
        atLimit: atLimit(values.offsetDb, DEVICE_OFFSET_LIMITS_DB),
      },
      walls,
      floors,
      calibration,
      before: stats(heldOut.map((r) => r.beforeDb)),
      after: stats(heldOut.map((r) => r.afterDb)),
      afterWithoutOffset: stats(heldOut.map((r) => r.afterWithoutOffsetDb)),
      heldOut,
    },
  }
}
