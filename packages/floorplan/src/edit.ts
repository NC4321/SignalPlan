import type { Point } from './geometry.ts'
import type { Floor, Wall, WallMaterial } from './schema.ts'
import { MIN_WALL_LENGTH_M } from './validate.ts'

/**
 * Editing operations on a floor. Each one mutates the floor it is given, so
 * it works on an Immer draft as well as a plain object, and keeps the floor
 * valid: walls join at shared nodes and openings stay inside their walls.
 */

/** Points closer than this are the same point, in metres. */
export const JOIN_TOLERANCE_M = 1e-3

/** An id with `prefix` that no node, wall or opening on the floor uses yet. */
export function nextId(floor: Floor, prefix: string): string {
  const used = new Set([
    ...floor.nodes.map((n) => n.id),
    ...floor.walls.map((w) => w.id),
    ...floor.openings.map((o) => o.id),
  ])
  let n = 1
  for (const id of used) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id)
    if (match) n = Math.max(n, Number(match[1]) + 1)
  }
  while (used.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

function nodePoint(floor: Floor, id: string): Point {
  const node = floor.nodes.find((n) => n.id === id)
  if (!node) throw new Error(`No node with id "${id}".`)
  return node
}

function wallEnds(floor: Floor, wall: Wall): [Point, Point] {
  return [nodePoint(floor, wall.from), nodePoint(floor, wall.to)]
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

/** Distance along a→b of the point on it nearest p, and how far p is from it. */
function project(a: Point, b: Point, p: Point) {
  const length = distance(a, b)
  const ux = (b.x - a.x) / length
  const uy = (b.y - a.y) / length
  const along = (p.x - a.x) * ux + (p.y - a.y) * uy
  const clamped = Math.min(Math.max(along, 0), length)
  const off = distance(p, { x: a.x + ux * clamped, y: a.y + uy * clamped })
  return { along: clamped, off, length }
}

/** The node at a point, if any. */
export function nodeAt(
  floor: Floor,
  p: Point,
  tolerance = JOIN_TOLERANCE_M,
): string | undefined {
  return floor.nodes.find((n) => distance(n, p) <= tolerance)?.id
}

/**
 * Splits a wall into two at the point on it nearest `p`, returning the node
 * at the split. If that point is inside a door or window, the split moves to
 * the opening's nearest edge so the opening stays whole. Splitting at (or
 * near) either end just returns that end's node.
 *
 * The first half keeps the wall's id; openings move to whichever half they
 * sit on, with offsets measured from that half's start.
 */
export function splitWall(
  floor: Floor,
  wallId: string,
  p: Point,
  tolerance = JOIN_TOLERANCE_M,
): string {
  const wall = floor.walls.find((w) => w.id === wallId)
  if (!wall) throw new Error(`No wall with id "${wallId}".`)
  const [a, b] = wallEnds(floor, wall)
  let { along } = project(a, b, p)
  const length = distance(a, b)

  const cut = floor.openings.find(
    (o) =>
      o.wallId === wallId &&
      along > o.offsetM + tolerance &&
      along < o.offsetM + o.widthM - tolerance,
  )
  if (cut) {
    const start = cut.offsetM
    const end = cut.offsetM + cut.widthM
    along = along - start <= end - along ? start : end
  }

  if (along <= tolerance) return wall.from
  if (along >= length - tolerance) return wall.to

  const t = along / length
  const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  const nodeId = nodeAt(floor, point, tolerance) ?? nextId(floor, 'n')
  if (!floor.nodes.some((n) => n.id === nodeId)) {
    floor.nodes.push({ id: nodeId, ...point })
  }

  const secondId = nextId(floor, 'w')
  floor.walls.push({
    id: secondId,
    from: nodeId,
    to: wall.to,
    material: wall.material,
  })
  wall.to = nodeId

  for (const opening of floor.openings) {
    if (opening.wallId !== wallId) continue
    if (opening.offsetM >= along - tolerance) {
      opening.wallId = secondId
      opening.offsetM = Math.max(opening.offsetM - along, 0)
    }
  }
  return nodeId
}

/**
 * The node where a new wall should attach at `p`: an existing node there, a
 * new junction on a wall passing through it (a T), or a new free node.
 */
function attach(floor: Floor, p: Point, tolerance: number): string {
  const existing = nodeAt(floor, p, tolerance)
  if (existing) return existing
  for (const wall of floor.walls) {
    const [a, b] = wallEnds(floor, wall)
    const { along, off, length } = project(a, b, p)
    if (off <= tolerance && along > tolerance && along < length - tolerance) {
      return splitWall(floor, wall.id, p, tolerance)
    }
  }
  const id = nextId(floor, 'n')
  floor.nodes.push({ id, x: p.x, y: p.y })
  return id
}

/** Where segments p→q and r→s cross strictly inside both, if they do. */
function properCrossing(p: Point, q: Point, r: Point, s: Point) {
  const dx1 = q.x - p.x
  const dy1 = q.y - p.y
  const dx2 = s.x - r.x
  const dy2 = s.y - r.y
  const denominator = dx1 * dy2 - dy1 * dx2
  const scale = Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2)
  if (Math.abs(denominator) <= 1e-9 * scale) return undefined
  const t = ((r.x - p.x) * dy2 - (r.y - p.y) * dx2) / denominator
  const u = ((r.x - p.x) * dy1 - (r.y - p.y) * dx1) / denominator
  const eps = 1e-9
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return undefined
  return { t, point: { x: p.x + dx1 * t, y: p.y + dy1 * t } }
}

/**
 * Adds a straight wall from `a` to `b`, returning the ids of the walls
 * created (none if it is too short or already exists).
 *
 * - Ends on an existing node join it; ends on the middle of a wall split it
 *   there (a T junction).
 * - Where the new wall crosses an existing wall, both are split and join
 *   (an X junction) — unless the crossing is inside a door or window, where
 *   they cross without joining.
 * - Stretches that run along an existing wall reuse it rather than
 *   duplicating it.
 */
export function addWall(
  floor: Floor,
  a: Point,
  b: Point,
  material: WallMaterial,
  tolerance = JOIN_TOLERANCE_M,
): string[] {
  if (distance(a, b) < MIN_WALL_LENGTH_M) return []
  const existingNodes = new Set(floor.nodes.map((n) => n.id))

  const startId = attach(floor, a, tolerance)
  const endId = attach(floor, b, tolerance)
  const start = nodePoint(floor, startId)
  const end = nodePoint(floor, endId)
  const length = distance(start, end)
  if (length < MIN_WALL_LENGTH_M) {
    dropUnusedNewNodes(floor, existingNodes)
    return []
  }

  // Every node the new wall passes through, by position along it.
  const stations = new Map<string, number>([
    [startId, 0],
    [endId, 1],
  ])

  for (const wall of [...floor.walls]) {
    const [r, s] = wallEnds(floor, wall)
    const crossing = properCrossing(start, end, r, s)
    if (!crossing) continue
    const { along } = project(r, s, crossing.point)
    const insideOpening = floor.openings.some(
      (o) =>
        o.wallId === wall.id &&
        along > o.offsetM + tolerance &&
        along < o.offsetM + o.widthM - tolerance,
    )
    if (insideOpening) continue
    const nodeId = splitWall(floor, wall.id, crossing.point, tolerance)
    stations.set(nodeId, crossing.t)
  }

  for (const node of floor.nodes) {
    if (stations.has(node.id)) continue
    const { along, off } = project(start, end, node)
    if (off <= tolerance && along > tolerance && along < length - tolerance) {
      stations.set(node.id, along / length)
    }
  }

  const ordered = [...stations].sort((p, q) => p[1] - q[1]).map(([id]) => id)
  const created: string[] = []
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!
    const to = ordered[i]!
    const p = nodePoint(floor, from)
    const q = nodePoint(floor, to)
    if (distance(p, q) < MIN_WALL_LENGTH_M) continue
    if (isCovered(floor, p, q, tolerance)) continue
    const id = nextId(floor, 'w')
    floor.walls.push({ id, from, to, material })
    created.push(id)
  }
  dropUnusedNewNodes(floor, existingNodes)
  return created
}

/** Removes nodes added during this edit that ended up joined to no wall. */
function dropUnusedNewNodes(floor: Floor, existing: Set<string>) {
  const used = new Set(floor.walls.flatMap((w) => [w.from, w.to]))
  floor.nodes = floor.nodes.filter((n) => existing.has(n.id) || used.has(n.id))
}

/** True if an existing wall already runs along the whole of p→q. */
function isCovered(floor: Floor, p: Point, q: Point, tolerance: number) {
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  return floor.walls.some((wall) => {
    const [a, b] = wallEnds(floor, wall)
    const onP = project(a, b, p).off <= tolerance
    const onQ = project(a, b, q).off <= tolerance
    return onP && onQ && project(a, b, mid).off <= tolerance
  })
}

/** Removes nodes that no wall uses. */
export function removeOrphanNodes(floor: Floor) {
  const used = new Set(floor.walls.flatMap((w) => [w.from, w.to]))
  floor.nodes = floor.nodes.filter((n) => used.has(n.id))
}
