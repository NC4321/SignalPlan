import {
  materialSegments,
  type AccessPoint,
  type Band,
  type Floor,
  type MaterialSegment,
  type Plan,
  type Point,
  type Radio,
} from '@signalplan/floorplan'
import { BAND_PROFILES } from './bands.ts'
import { wallLoss } from './crossings.ts'
import { floorAreaMask } from './floorArea.ts'
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
}

/** Around access points on a floor with no walls yet, the grid reaches this far. */
const OPEN_FLOOR_REACH_M = 5

/**
 * The grid covering a floor's walls and access points plus a 1 m margin,
 * snapped to whole cells. On a floor with no walls yet, it reaches 5 m around
 * each access point so there is coverage to see before any walls are drawn.
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
  if (points.length === 0) {
    return { originX: 0, originY: 0, cellM, cols: 0, rows: 0 }
  }
  const minX = Math.min(...points.map((p) => p.x - p.margin))
  const minY = Math.min(...points.map((p) => p.y - p.margin))
  const maxX = Math.max(...points.map((p) => p.x + p.margin))
  const maxY = Math.max(...points.map((p) => p.y + p.margin))
  const originX = Math.floor(minX / cellM) * cellM
  const originY = Math.floor(minY / cellM) * cellM
  const cols = Math.ceil((maxX - originX) / cellM)
  const rows = Math.ceil((maxY - originY) / cellM)
  return { originX, originY, cellM, cols, rows }
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
  const profile = BAND_PROFILES[radio.band]
  const eirp = radio.txPowerDbm ?? profile.defaultTxPowerDbm
  const dz = ap.heightM - RECEIVER_HEIGHT_M
  const distance = Math.max(Math.hypot(point.x - ap.x, point.y - ap.y, dz), 1)
  const losses = MATERIAL_LOSS_DB[radio.band]
  const walls = wallLoss(segments, ap, point, (material) => losses[material])
  return (
    eirp -
    profile.referenceLossDb -
    10 * profile.pathLossExponent * Math.log10(distance) -
    walls
  )
}

/**
 * Predicted coverage of one floor in one band. Each cell takes the strongest
 * signal from any access point on this floor with a radio in the band.
 *
 * Access points on other floors are ignored until multi-floor support (Phase 5).
 */
export function evaluateCoverage(
  plan: Plan,
  floorId: string,
  band: Band,
  cellM = DEFAULT_CELL_M,
): Coverage {
  const floor = plan.floors.find((f) => f.id === floorId)
  if (!floor) throw new RangeError(`No floor with id "${floorId}".`)

  const onFloor = plan.accessPoints.filter((ap) => ap.floorId === floorId)
  const grid = gridForFloor(floor, cellM, onFloor)
  const segments = materialSegments(floor)
  const size = grid.cols * grid.rows
  const dbm = new Float32Array(size).fill(Number.NEGATIVE_INFINITY)
  const strongest = new Int16Array(size).fill(-1)

  const sources = plan.accessPoints.flatMap((ap) => {
    const radio = ap.radios.find((r) => r.band === band)
    return ap.floorId === floorId && radio ? [{ ap, radio }] : []
  })

  sources.forEach(({ ap, radio }, index) => {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const i = row * grid.cols + col
        const value = predictDbm(
          segments,
          ap,
          radio,
          cellCentre(grid, col, row),
        )
        if (value > dbm[i]!) {
          dbm[i] = value
          strongest[i] = index
        }
      }
    }
  })

  return {
    grid,
    band,
    dbm,
    strongest,
    floorArea: floorAreaMask(floor, grid),
    accessPointIds: sources.map(({ ap }) => ap.id),
  }
}
