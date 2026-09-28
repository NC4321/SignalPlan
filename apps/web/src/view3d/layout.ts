import type { Coverage } from '@signalplan/engine'
import {
  materialSegments,
  stackedFloors,
  type AccessPoint,
  type Floor,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import { qualityOf } from '../quality.ts'

/**
 * What the 3D view draws (D57), worked out without three.js so it can be
 * tested. Plan x and y lie flat; heights are metres above the lowest floor.
 */

/** Height of cut-away walls, so the heatmap on each floor stays in view. */
export const CUTAWAY_M = 1

/** Wall thickness in the view, as drawn in 2D (12 cm). */
export const WALL_THICKNESS_M = 0.12

export interface FloorLayout {
  floor: Floor
  /** Height of the floor's surface in the view: its elevation plus spread. */
  baseM: number
}

/**
 * The floors to draw, from the lowest up. Each is lifted by `spreadM` for
 * every floor below it in the stack, hidden ones included, so hiding a floor
 * never moves the others.
 */
export function floorLayouts(
  plan: Plan,
  hidden: readonly string[],
  spreadM: number,
): FloorLayout[] {
  return stackedFloors(plan.floors).flatMap((floor, i) =>
    hidden.includes(floor.id)
      ? []
      : [{ floor, baseM: floor.elevationM + i * spreadM }],
  )
}

export interface WallBox {
  /** Middle of the wall on the plan. */
  x: number
  y: number
  length: number
  /** Direction along the wall, in radians from plan +x towards plan +y. */
  angle: number
  height: number
  material: WallMaterial
  /** A door or window rather than solid wall. */
  opening: boolean
}

/**
 * Each wall segment as a box standing on the floor: to the ceiling, or cut
 * away at 1 m (never above the ceiling). Doorways with no door leave a gap,
 * as in 2D.
 */
export function wallBoxes(floor: Floor, fullHeight: boolean): WallBox[] {
  const height = fullHeight ? floor.heightM : Math.min(CUTAWAY_M, floor.heightM)
  return materialSegments(floor).map((segment) => {
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    return {
      x: (segment.a.x + segment.b.x) / 2,
      y: (segment.a.y + segment.b.y) / 2,
      length: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx),
      height,
      material: segment.material,
      opening: segment.openingId !== undefined,
    }
  })
}

/** Colour of floor inside the walls where no signal reaches, RGBA. */
const NO_SIGNAL: readonly [number, number, number, number] = [
  160, 160, 160, 200,
]

/**
 * The heatmap drawn on one floor, one RGBA pixel per coverage cell, row by
 * row from the grid's top (smallest y). Inside the walls each cell has its
 * quality colour, or grey where there's no signal; outside, cells are clear,
 * so each floor reads as its own shape. Openings in the floor aren't floor
 * area, so they're clear too. A floor with no closed outline has no floor
 * area, so it shows the heatmap everywhere, fainter.
 */
export function heatmapPixels(coverage: Coverage): Uint8ClampedArray {
  const { cols, rows } = coverage.grid
  const pixels = new Uint8ClampedArray(cols * rows * 4)
  const hasArea = coverage.floorArea.some((inside) => inside === 1)
  for (let i = 0; i < cols * rows; i++) {
    const band = qualityOf(coverage.dbm[i]!)
    if (hasArea && !coverage.floorArea[i]) continue
    if (band) pixels.set([...band.rgb, hasArea ? 235 : 140], i * 4)
    else if (hasArea) pixels.set(NO_SIGNAL, i * 4)
  }
  return pixels
}

export interface AccessPointMarker {
  ap: AccessPoint
  /** Height of the access point in the view. */
  heightM: number
}

/** Access points on the floors drawn, at their mounting height. */
export function accessPointMarkers(
  plan: Plan,
  layouts: readonly FloorLayout[],
): AccessPointMarker[] {
  const base = new Map(layouts.map((l) => [l.floor.id, l.baseM]))
  return plan.accessPoints.flatMap((ap) => {
    const floorBase = base.get(ap.floorId)
    return floorBase === undefined
      ? []
      : [{ ap, heightM: floorBase + ap.heightM }]
  })
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Lowest floor surface and highest ceiling drawn. */
  bottomM: number
  topM: number
}

/** What the camera frames: every drawn floor's corners and access points. */
export function sceneBounds(
  plan: Plan,
  layouts: readonly FloorLayout[],
): Bounds | undefined {
  const points = layouts.flatMap(({ floor }) => floor.nodes)
  const drawn = new Set(layouts.map((l) => l.floor.id))
  points.push(...plan.accessPoints.filter((ap) => drawn.has(ap.floorId)))
  if (layouts.length === 0 || points.length === 0) return undefined
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
    bottomM: Math.min(...layouts.map((l) => l.baseM)),
    topM: Math.max(...layouts.map((l) => l.baseM + l.floor.heightM)),
  }
}
