import type { Floor, Point } from '@signalplan/floorplan'
import { snapStep, type Units } from './units.ts'

/** Snap targets within this many screen pixels of the pointer win. */
export const SNAP_RADIUS_PX = 10
/** Angle steps from the previous point, in degrees (D16). */
export const ANGLE_STEP_DEG = 15

export type SnapKind =
  | 'node'
  | 'wall'
  /** A corner or wall of the ghosted floor below (D53). */
  | 'ghost-node'
  | 'ghost-wall'
  | 'angle'
  | 'grid'
  | 'none'

export interface Snap {
  point: Point
  kind: SnapKind
}

interface Options {
  /** Pixels per metre, so the snap radius stays constant on screen. */
  scale: number
  units: Units
  /** The previous point of the chain being drawn, if any. */
  anchor?: Point | undefined
  /** Alt held: no snapping at all. */
  disabled?: boolean
  /** The ghosted floor below, whose corners and walls snap too (D53). */
  ghost?: Floor | undefined
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * Where a drawing click at `raw` lands. In order of priority: an existing
 * corner, a point on an existing wall, a corner or then a wall of the ghosted
 * floor below (D53), then (while drawing from an anchor) a 15° direction with
 * its length rounded to the grid step, or (with no anchor) the nearest grid
 * point.
 */
export function snapPoint(floor: Floor, raw: Point, options: Options): Snap {
  if (options.disabled) return { point: raw, kind: 'none' }
  const radius = SNAP_RADIUS_PX / options.scale

  const node = nearestNode(floor, raw, radius)
  if (node) return { point: node, kind: 'node' }

  const onWall = nearestOnWalls(floor, raw, radius)
  if (onWall) {
    // Prefer where the 15° direction from the anchor meets the wall, if the
    // pointer is near that spot too: it satisfies both snaps.
    if (options.anchor) {
      const hit = rayHitsWalls(
        floor,
        options.anchor,
        snappedAngle(options.anchor, raw),
      )
      if (hit && distance(hit, raw) <= radius)
        return { point: hit, kind: 'wall' }
    }
    return { point: onWall, kind: 'wall' }
  }

  if (options.ghost) {
    const ghostNode = nearestNode(options.ghost, raw, radius)
    if (ghostNode) return { point: ghostNode, kind: 'ghost-node' }
    const onGhostWall = nearestOnWalls(options.ghost, raw, radius)
    if (onGhostWall) return { point: onGhostWall, kind: 'ghost-wall' }
  }

  if (options.anchor) {
    return {
      point: angleSnap(options.anchor, raw, options.units),
      kind: 'angle',
    }
  }
  const step = snapStep(options.units)
  return {
    point: {
      x: Math.round(raw.x / step) * step,
      y: Math.round(raw.y / step) * step,
    },
    kind: 'grid',
  }
}

/** The floor's corner nearest `raw`, within `radius`. */
function nearestNode(floor: Floor, raw: Point, radius: number) {
  let best: Point | undefined
  let bestDistance = radius
  for (const node of floor.nodes) {
    const d = distance(node, raw)
    if (d <= bestDistance) {
      best = { x: node.x, y: node.y }
      bestDistance = d
    }
  }
  return best
}

/** The point on the floor's walls nearest `raw`, within `radius`. */
function nearestOnWalls(floor: Floor, raw: Point, radius: number) {
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]))
  let best: Point | undefined
  let bestDistance = radius
  for (const wall of floor.walls) {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    if (!a || !b) continue
    const onWall = nearestOnSegment(a, b, raw)
    const d = distance(onWall, raw)
    if (d <= bestDistance) {
      best = onWall
      bestDistance = d
    }
  }
  return best
}

function snappedAngle(anchor: Point, raw: Point): number {
  const stepRad = (ANGLE_STEP_DEG * Math.PI) / 180
  const angle = Math.atan2(raw.y - anchor.y, raw.x - anchor.x)
  return Math.round(angle / stepRad) * stepRad
}

/** The point at a 15° direction from `anchor`, at a whole number of grid steps. */
export function angleSnap(anchor: Point, raw: Point, units: Units): Point {
  const step = snapStep(units)
  const angle = snappedAngle(anchor, raw)
  const length = Math.round(distance(anchor, raw) / step) * step
  return {
    x: anchor.x + Math.cos(angle) * length,
    y: anchor.y + Math.sin(angle) * length,
  }
}

/**
 * The point `length` metres from `anchor` at a bearing in degrees, measured
 * counter-clockwise from east as on a map (plan y points down).
 */
export function pointAtBearing(
  anchor: Point,
  length: number,
  bearing: number,
): Point {
  const angle = (-bearing * Math.PI) / 180
  return {
    x: anchor.x + Math.cos(angle) * length,
    y: anchor.y + Math.sin(angle) * length,
  }
}

/**
 * Direction of a→b in degrees, measured counter-clockwise from east as on a
 * map (plan y points down, so the sign is flipped).
 */
export function bearingDeg(a: Point, b: Point): number {
  const deg = (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return (deg + 360) % 360
}

export function nearestOnSegment(a: Point, b: Point, p: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { x: a.x, y: a.y }
  const t = Math.min(
    Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0),
    1,
  )
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/** The nearest point where a ray from `origin` at `angle` meets a wall. */
function rayHitsWalls(floor: Floor, origin: Point, angle: number) {
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]))
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let best: { t: number; point: Point } | undefined
  for (const wall of floor.walls) {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    if (!a || !b) continue
    const sx = b.x - a.x
    const sy = b.y - a.y
    const denominator = dx * sy - dy * sx
    if (Math.abs(denominator) < 1e-12) continue
    const t = ((a.x - origin.x) * sy - (a.y - origin.y) * sx) / denominator
    const u = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / denominator
    if (t <= 1e-9 || u < 0 || u > 1) continue
    if (!best || t < best.t) {
      best = { t, point: { x: origin.x + dx * t, y: origin.y + dy * t } }
    }
  }
  return best?.point
}
