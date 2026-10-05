import {
  type AccessPoint,
  type Band,
  type Floor,
  type MaterialSegment,
  type Plan,
  type Point,
  type Radio,
} from '@signalplan/floorplan'
import { BAND_PROFILES } from './bands.ts'
import { indexedWallLoss, indexWalls, wallLoss } from './crossings.ts'
import { floorAreaMask } from './floorArea.ts'
import { crossingLossDb, floorCrossing, prepareStack } from './floors.ts'
import { MATERIAL_LOSS_DB } from './materials.ts'

/** Height of the receiving device above the floor: a phone in hand or on a desk. */
export const RECEIVER_HEIGHT_M = 1

/** Default grid cell size, in metres. */
export const DEFAULT_CELL_M = 0.1

/** Empty space around the plan's walls that the grid also covers. */
const MARGIN_M = 1

/**
 * A regular grid over a floor. Cell (col, row) is centred at
 * (originX + (col + 0.5)·cellM, originY + (row + 0.5)·cellM).
 * Values are stored row by row: index = row·cols + col.
 */
export interface Grid {
  originX: number
  originY: number
  cellM: number
  cols: number
  rows: number
}

export interface Coverage {
  grid: Grid
  band: Band
  /** Predicted signal in dBm per cell, from the strongest access point. */
  dbm: Float32Array
  /** Index into `accessPointIds` of the strongest access point, or −1 if none. */
  strongest: Int16Array
  /** 1 for cells inside the floor's walls, 0 outside (see `floorAreaMask`). */
  floorArea: Uint8Array
  accessPointIds: string[]
  /**
   * Each access point's signal in dBm per cell, one grid after another in the
   * order of `accessPointIds`, for the Overlap view (D64).
   */
  sourceDbm: Float32Array
  /**
   * The neighbours' networks with a location and a channel on this band
   * (D84), and each one's signal in dBm per cell, one grid after another in
   * this order, for the Interference view.
   */
  neighbourIds: string[]
  neighbourDbm: Float32Array
}

/** Around access points on a floor with no walls yet, the grid reaches this far. */
const OPEN_FLOOR_REACH_M = 5

/**
 * The most cells a grid may have (D100). About a megapixel keeps a drag's
 * recompute near the 200 ms budget (D11) on a floor of a few walls; past it,
 * cells get coarser rather than the grid larger.
 */
export const MAX_GRID_CELLS = 1_000_000

/** Steps a coarsened cell size takes within each power of ten (D100). */
const COARSER_STEPS = [1, 2, 2.5, 5]

/**
 * The grid covering a floor's walls and access points plus a 1 m margin,
 * snapped to whole cells. On a floor with no walls yet, it reaches 5 m around
 * each access point so there is coverage to see before any walls are drawn.
 *
 * `cellM` is the finest cell size. A floor that would need more than
 * `MAX_GRID_CELLS` of them gets the first coarser size, 2, 2.5, 5, 10, 20…
 * times it, that fits (D100), so read the size from the grid's `cellM`.
 */
export function gridForFloor(
  floor: Floor,
  cellM = DEFAULT_CELL_M,
  accessPoints: readonly Point[] = [],
): Grid {
  const margin = floor.nodes.length === 0 ? OPEN_FLOOR_REACH_M : MARGIN_M
  const points = [
    ...floor.nodes.map((node) => ({ ...node, margin: MARGIN_M })),
    ...accessPoints.map((ap) => ({ x: ap.x, y: ap.y, margin })),
  ]
  const empty = { originX: 0, originY: 0, cellM, cols: 0, rows: 0 }
  if (points.length === 0) return empty
  const minX = Math.min(...points.map((p) => p.x - p.margin))
  const minY = Math.min(...points.map((p) => p.y - p.margin))
  const maxX = Math.max(...points.map((p) => p.x + p.margin))
  const maxY = Math.max(...points.map((p) => p.y + p.margin))
  if (!(cellM > 0) || ![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return empty
  }
  for (let decade = 1; ; decade *= 10) {
    for (const step of COARSER_STEPS) {
      const size = cellM * (step * decade)
      const originX = Math.floor(minX / size) * size
      const originY = Math.floor(minY / size) * size
      const cols = Math.ceil((maxX - originX) / size)
      const rows = Math.ceil((maxY - originY) / size)
      if (cols * rows <= MAX_GRID_CELLS) {
        return { originX, originY, cellM: size, cols, rows }
      }
    }
  }
}

export function cellCentre(grid: Grid, col: number, row: number): Point {
  return {
    x: grid.originX + (col + 0.5) * grid.cellM,
    y: grid.originY + (row + 0.5) * grid.cellM,
  }
}

/**
 * Predicted signal in dBm at a point from one radio (docs/MODEL.md):
 * EIRP − [PL(1 m) + 10·n·log10(d) + Σ wall losses].
 * Distance is 3D, between the access point's mounting height and the
 * receiver's; within 1 m the 1 m value is used.
 */
export function predictDbm(
  segments: readonly MaterialSegment[],
  ap: AccessPoint,
  radio: Radio,
  point: Point,
): number {
  const losses = MATERIAL_LOSS_DB[radio.band]
  const walls = wallLoss(segments, ap, point, (material) => losses[material])
  return signalDbm(ap, radio, point.x, point.y, walls)
}

/**
 * EIRP − [PL(1 m) + 10·n·log10(d) + walls], given the walls' total loss.
 * `dz` is the access point's height above the receiver, which on its own
 * floor follows from its mounting height. `exponent` is n, the band's
 * unless calibrated (D75).
 */
export function signalDbm(
  ap: Pick<AccessPoint, 'x' | 'y' | 'heightM'>,
  radio: Radio,
  x: number,
  y: number,
  walls: number,
  dz = ap.heightM - RECEIVER_HEIGHT_M,
  exponent?: number,
): number {
  const profile = BAND_PROFILES[radio.band]
  const eirp = radio.txPowerDbm ?? profile.defaultTxPowerDbm
  const distance = Math.max(Math.hypot(x - ap.x, y - ap.y, dz), 1)
  return (
    eirp -
    profile.referenceLossDb -
    10 * (exponent ?? profile.pathLossExponent) * Math.log10(distance) -
    walls
  )
}

/**
 * Predicted coverage of one floor in one band. Each cell takes the strongest
 * signal from any access point with a radio in the band, on this floor or
 * another (D51). From another floor the distance is 3D, between the access
 * point and a receiver 1 m above this floor, and the path pays the slabs it
 * crosses and each floor's walls along its stretch in that storey. The
 * plan's calibrated values replace the defaults where it has them (D76).
 */
export function evaluateCoverage(
  plan: Plan,
  floorId: string,
  band: Band,
  cellM = DEFAULT_CELL_M,
): Coverage {
  const floor = plan.floors.find((f) => f.id === floorId)
  if (!floor) throw new RangeError(`No floor with id "${floorId}".`)

  // A floor with no walls yet shows what reaches it from other floors too.
  const nearby = plan.accessPoints.filter(
    (ap) => ap.floorId === floorId || floor.nodes.length === 0,
  )
  const grid = gridForFloor(floor, cellM, nearby)
  const size = grid.cols * grid.rows
  const dbm = new Float32Array(size).fill(Number.NEGATIVE_INFINITY)
  const strongest = new Int16Array(size).fill(-1)

  // Walls are prepared once, so each cell only does the arithmetic of
  // `predictDbm`, in the same order and with the same result. A path from
  // another floor splits into stretches that depend only on its two heights,
  // so each source works them out once.
  const stack = prepareStack(plan, band)
  const exponent = plan.calibration?.[band]?.pathLossExponent
  const storeyOf = new Map(stack.map((storey, i) => [storey.floor.id, i]))
  const here = storeyOf.get(floorId)!
  const receiverZ = floor.elevationM + RECEIVER_HEIGHT_M
  const walls = stack[here]!.walls
  const sources = plan.accessPoints.flatMap((ap) => {
    const radio = ap.radios.find((r) => r.band === band)
    const from = storeyOf.get(ap.floorId)
    return radio && from !== undefined ? [{ ap, radio, from }] : []
  })
  const sourceDbm = new Float32Array(size * sources.length)
  // One source's signal over the grid, into `out` from `offset`.
  const fill = (
    source: Pick<AccessPoint, 'x' | 'y' | 'heightM'>,
    radio: Radio,
    from: number,
    out: Float32Array,
    offset: number,
  ) => {
    const apZ = stack[from]!.floor.elevationM + source.heightM
    // Walls sorted by direction from the access point (D56).
    const crossing =
      from === here
        ? undefined
        : floorCrossing(stack, from, apZ, here, receiverZ, source)
    const sorted = crossing ? undefined : indexWalls(walls, source.x, source.y)
    // On its own floor, exactly as `predictDbm` works it out.
    const dz = crossing ? apZ - receiverZ : source.heightM - RECEIVER_HEIGHT_M
    for (let row = 0; row < grid.rows; row++) {
      const y = grid.originY + (row + 0.5) * grid.cellM
      for (let col = 0; col < grid.cols; col++) {
        const x = grid.originX + (col + 0.5) * grid.cellM
        const loss = crossing
          ? crossingLossDb(crossing, source.x, source.y, x, y)
          : indexedWallLoss(sorted!, source.x, source.y, x, y)
        out[offset + row * grid.cols + col] = signalDbm(
          source,
          radio,
          x,
          y,
          loss,
          dz,
          exponent,
        )
      }
    }
  }
  sources.forEach(({ ap, radio, from }, index) => {
    const offset = index * size
    fill(ap, radio, from, sourceDbm, offset)
    for (let i = 0; i < size; i++) {
      const value = sourceDbm[offset + i]!
      if (value > dbm[i]!) {
        dbm[i] = value
        strongest[i] = index
      }
    }
  })

  // Neighbours' networks with a location and a channel on this band (D84),
  // worked out as an access point is, at their fitted power.
  const neighbours = (plan.neighbourNetworks ?? []).flatMap((n) => {
    const from = n.location && storeyOf.get(n.location.floorId)
    return n.band === band && n.channel !== undefined && from !== undefined
      ? [{ id: n.id, location: n.location!, from }]
      : []
  })
  const neighbourDbm = new Float32Array(size * neighbours.length)
  neighbours.forEach(({ location, from }, index) => {
    fill(
      location,
      { band, txPowerDbm: location.eirpDbm },
      from,
      neighbourDbm,
      index * size,
    )
  })

  return {
    grid,
    band,
    dbm,
    strongest,
    floorArea: floorAreaMask(floor, grid),
    accessPointIds: sources.map(({ ap }) => ap.id),
    sourceDbm,
    neighbourIds: neighbours.map(({ id }) => id),
    neighbourDbm,
  }
}
