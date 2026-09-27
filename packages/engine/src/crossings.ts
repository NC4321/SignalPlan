import type {
  MaterialSegment,
  Point,
  WallMaterial,
} from '@signalplan/floorplan'

/** Two hits closer than this along a path are the same physical crossing. */
const SAME_CROSSING_M = 1e-6

/**
 * One place where a path passes through the walls. Usually a single segment,
 * but a path through a corner or the edge of a door touches several segments
 * at the same point; they are grouped so the crossing is only counted once.
 */
export interface Crossing {
  /** Position along the path, from 0 at the start to 1 at the end. */
  t: number
  segments: MaterialSegment[]
}

/**
 * Finds every wall crossing on the straight path from `from` to `to`, in order.
 *
 * Touching a segment's end or the path's own end counts as a crossing. A path
 * that runs along a wall (collinear) grazes it and does not count.
 */
export function crossings(
  segments: readonly MaterialSegment[],
  from: Point,
  to: Point,
): Crossing[] {
  const rx = to.x - from.x
  const ry = to.y - from.y
  const pathLength = Math.hypot(rx, ry)
  if (pathLength === 0) return []

  const hits: { t: number; segment: MaterialSegment }[] = []
  for (const segment of segments) {
    const t = intersect(from, rx, ry, pathLength, segment)
    if (t !== null) hits.push({ t, segment })
  }
  hits.sort((p, q) => p.t - q.t)

  const sameT = SAME_CROSSING_M / pathLength
  const result: Crossing[] = []
  for (const hit of hits) {
    const last = result.at(-1)
    if (last && hit.t - last.t <= sameT) {
      last.segments.push(hit.segment)
    } else {
      result.push({ t: hit.t, segments: [hit.segment] })
    }
  }
  return result
}

/**
 * Total wall loss in dB along the path from `from` to `to`. Where one crossing
 * touches several segments, the most lossy one counts.
 */
export function wallLoss(
  segments: readonly MaterialSegment[],
  from: Point,
  to: Point,
  lossOf: (material: WallMaterial) => number,
): number {
  let total = 0
  for (const crossing of crossings(segments, from, to)) {
    total += Math.max(...crossing.segments.map((s) => lossOf(s.material)))
  }
  return total
}

/**
 * Where the path `from + t·r` meets the segment, as t in [0, 1], or null.
 * Uses the 2D cross product form of line–line intersection.
 */
function intersect(
  from: Point,
  rx: number,
  ry: number,
  pathLength: number,
  segment: MaterialSegment,
): number | null {
  const sx = segment.b.x - segment.a.x
  const sy = segment.b.y - segment.a.y
  const segmentLength = Math.hypot(sx, sy)
  if (segmentLength === 0) return null

  const denominator = rx * sy - ry * sx
  // Parallel or collinear: sin(angle) below ~1e-9 is treated as no crossing.
  if (Math.abs(denominator) <= 1e-9 * pathLength * segmentLength) return null

  const qx = segment.a.x - from.x
  const qy = segment.a.y - from.y
  const t = (qx * sy - qy * sx) / denominator
  const u = (qx * ry - qy * rx) / denominator

  const slackT = SAME_CROSSING_M / pathLength
  const slackU = SAME_CROSSING_M / segmentLength
  if (t < -slackT || t > 1 + slackT || u < -slackU || u > 1 + slackU) {
    return null
  }
  return Math.min(Math.max(t, 0), 1)
}
