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

/**
 * Wall segments prepared once for many wall-loss sums, as in a coverage grid:
 * each segment's direction, length, bounding box and loss are computed up
 * front, and hits go into reused buffers instead of new arrays.
 */
export interface PreparedWalls {
  count: number
  ax: Float64Array
  ay: Float64Array
  sx: Float64Array
  sy: Float64Array
  length: Float64Array
  minX: Float64Array
  minY: Float64Array
  maxX: Float64Array
  maxY: Float64Array
  loss: Float64Array
  /** Scratch space for the hits on one path, sorted by position. */
  hitT: Float64Array
  hitLoss: Float64Array
}

/**
 * A segment whose bounding box is further than this from the path's can't be
 * crossed: every crossing lies within SAME_CROSSING_M of both.
 */
const BOX_MARGIN_M = 1e-3

export function prepareWalls(
  segments: readonly MaterialSegment[],
  lossOf: (material: WallMaterial) => number,
): PreparedWalls {
  const count = segments.length
  const array = () => new Float64Array(count)
  const walls: PreparedWalls = {
    count,
    ax: array(),
    ay: array(),
    sx: array(),
    sy: array(),
    length: array(),
    minX: array(),
    minY: array(),
    maxX: array(),
    maxY: array(),
    loss: array(),
    hitT: array(),
    hitLoss: array(),
  }
  segments.forEach((segment, i) => {
    const sx = segment.b.x - segment.a.x
    const sy = segment.b.y - segment.a.y
    walls.ax[i] = segment.a.x
    walls.ay[i] = segment.a.y
    walls.sx[i] = sx
    walls.sy[i] = sy
    walls.length[i] = Math.hypot(sx, sy)
    walls.minX[i] = Math.min(segment.a.x, segment.b.x) - BOX_MARGIN_M
    walls.minY[i] = Math.min(segment.a.y, segment.b.y) - BOX_MARGIN_M
    walls.maxX[i] = Math.max(segment.a.x, segment.b.x) + BOX_MARGIN_M
    walls.maxY[i] = Math.max(segment.a.y, segment.b.y) + BOX_MARGIN_M
    walls.loss[i] = lossOf(segment.material)
  })
  return walls
}

/**
 * The same total as `wallLoss`, bit for bit, for walls from `prepareWalls`.
 * It does the same arithmetic in the same order; it only skips segments whose
 * bounding box is clear of the path's, and allocates nothing.
 */
export function preparedWallLoss(
  walls: PreparedWalls,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const rx = toX - fromX
  const ry = toY - fromY
  const pathLength = Math.hypot(rx, ry)
  if (pathLength === 0) return 0
  const loX = Math.min(fromX, toX)
  const loY = Math.min(fromY, toY)
  const hiX = Math.max(fromX, toX)
  const hiY = Math.max(fromY, toY)
  const slackT = SAME_CROSSING_M / pathLength
  const { hitT, hitLoss } = walls

  let hits = 0
  for (let i = 0; i < walls.count; i++) {
    if (
      walls.maxX[i]! < loX ||
      walls.minX[i]! > hiX ||
      walls.maxY[i]! < loY ||
      walls.minY[i]! > hiY
    ) {
      continue
    }
    const segmentLength = walls.length[i]!
    if (segmentLength === 0) continue
    const sx = walls.sx[i]!
    const sy = walls.sy[i]!
    // As in `intersect`.
    const denominator = rx * sy - ry * sx
    if (Math.abs(denominator) <= 1e-9 * pathLength * segmentLength) continue
    const qx = walls.ax[i]! - fromX
    const qy = walls.ay[i]! - fromY
    const t = (qx * sy - qy * sx) / denominator
    const u = (qx * ry - qy * rx) / denominator
    const slackU = SAME_CROSSING_M / segmentLength
    if (t < -slackT || t > 1 + slackT || u < -slackU || u > 1 + slackU) {
      continue
    }
    // Insert in order of t, after equal ones, like the stable sort in `crossings`.
    const at = Math.min(Math.max(t, 0), 1)
    let j = hits
    while (j > 0 && hitT[j - 1]! > at) {
      hitT[j] = hitT[j - 1]!
      hitLoss[j] = hitLoss[j - 1]!
      j--
    }
    hitT[j] = at
    hitLoss[j] = walls.loss[i]!
    hits++
  }

  // Group hits into crossings as `crossings` does; each counts its lossiest.
  let total = 0
  let i = 0
  while (i < hits) {
    const start = hitT[i]!
    let loss = hitLoss[i]!
    i++
    while (i < hits && hitT[i]! - start <= slackT) {
      loss = Math.max(loss, hitLoss[i]!)
      i++
    }
    total += loss
  }
  return total
}
