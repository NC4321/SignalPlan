import { pointInPolygon, type Floor, type Point } from '@signalplan/floorplan'
import type { Coverage, Grid } from './coverage.ts'

/**
 * Which cells of a grid lie inside the floor's walls: 1 inside, 0 outside.
 *
 * The outside is flooded in from the grid's edge, stepping between
 * neighbouring cell centres; a step is blocked when it touches a wall. Every
 * cell the flood can't reach is inside. Doors and windows sit on walls, so
 * they count as closed. A plan with no closed outline has no inside cells.
 *
 * A cell whose centre lies exactly on a wall can't be reached either, so it
 * counts as inside: the area may run up to half a cell over along such walls,
 * but the flood never leaks through a closed outline.
 *
 * Cells whose centre lies in an opening in the floor, such as a stairwell,
 * aren't floor either (D54).
 */
export function floorAreaMask(floor: Floor, grid: Grid): Uint8Array {
  const { cols, rows, cellM } = grid
  const inside = new Uint8Array(cols * rows)
  if (cols === 0 || rows === 0) return inside
  const { blockedRight, blockedDown } = wallSteps(floor, grid)
  const clampCol = (col: number) => Math.min(Math.max(col, 0), cols - 1)
  const clampRow = (row: number) => Math.min(Math.max(row, 0), rows - 1)
  const centre = (col: number, row: number): Point => ({
    x: grid.originX + (col + 0.5) * cellM,
    y: grid.originY + (row + 0.5) * cellM,
  })

  const reached = new Uint8Array(cols * rows)
  const queue = new Int32Array(cols * rows)
  let head = 0
  let tail = 0
  const visit = (i: number) => {
    if (reached[i]) return
    reached[i] = 1
    queue[tail++] = i
  }
  for (let col = 0; col < cols; col++) {
    visit(col)
    visit((rows - 1) * cols + col)
  }
  for (let row = 0; row < rows; row++) {
    visit(row * cols)
    visit(row * cols + cols - 1)
  }
  while (head < tail) {
    const i = queue[head++]!
    const col = i % cols
    if (col + 1 < cols && !blockedRight[i]) visit(i + 1)
    if (col > 0 && !blockedRight[i - 1]) visit(i - 1)
    if (i + cols < cols * rows && !blockedDown[i]) visit(i + cols)
    if (i >= cols && !blockedDown[i - cols]) visit(i - cols)
  }

  for (let i = 0; i < inside.length; i++) inside[i] = reached[i] ? 0 : 1
  for (const { points } of floor.floorOpenings ?? []) {
    const col0 = clampCol(
      Math.floor((Math.min(...points.map((p) => p.x)) - grid.originX) / cellM),
    )
    const col1 = clampCol(
      Math.floor((Math.max(...points.map((p) => p.x)) - grid.originX) / cellM),
    )
    const row0 = clampRow(
      Math.floor((Math.min(...points.map((p) => p.y)) - grid.originY) / cellM),
    )
    const row1 = clampRow(
      Math.floor((Math.max(...points.map((p) => p.y)) - grid.originY) / cellM),
    )
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        if (pointInPolygon(centre(col, row), points))
          inside[row * cols + col] = 0
      }
    }
  }
  return inside
}

/** One room of a floor: an enclosed part of its area (see `floorRooms`). */
export interface Room {
  areaM2: number
  /** A point inside the room: its cell nearest the room's centroid. */
  x: number
  y: number
}

export interface FloorRooms {
  rooms: Room[]
  /** Index into `rooms` of each grid cell's room, or −1 for none. */
  roomOf: Int32Array
}

/**
 * The floor's area (`floorAreaMask`) split into rooms: cells joined by steps
 * that touch no wall. Doors and windows count as closed, so each room is
 * what they'd close off. Rooms are in the order of their first cell, row by
 * row.
 */
export function floorRooms(floor: Floor, grid: Grid): FloorRooms {
  const { cols, rows, cellM } = grid
  const size = cols * rows
  const roomOf = new Int32Array(size).fill(-1)
  const rooms: Room[] = []
  if (size === 0) return { rooms, roomOf }
  const inside = floorAreaMask(floor, grid)
  const { blockedRight, blockedDown } = wallSteps(floor, grid)
  const queue = new Int32Array(size)
  for (let start = 0; start < size; start++) {
    if (!inside[start] || roomOf[start]! >= 0) continue
    const room = rooms.length
    let head = 0
    let tail = 0
    const visit = (i: number) => {
      if (!inside[i] || roomOf[i]! >= 0) return
      roomOf[i] = room
      queue[tail++] = i
    }
    visit(start)
    let sumCol = 0
    let sumRow = 0
    while (head < tail) {
      const i = queue[head++]!
      const col = i % cols
      sumCol += col
      sumRow += (i - col) / cols
      if (col + 1 < cols && !blockedRight[i]) visit(i + 1)
      if (col > 0 && !blockedRight[i - 1]) visit(i - 1)
      if (i + cols < size && !blockedDown[i]) visit(i + cols)
      if (i >= cols && !blockedDown[i - cols]) visit(i - cols)
    }
    // The room's cell nearest its centroid, so the point is inside even
    // for an L-shaped room.
    const midCol = sumCol / tail
    const midRow = sumRow / tail
    let best = start
    let bestDistance = Number.POSITIVE_INFINITY
    for (let k = 0; k < tail; k++) {
      const i = queue[k]!
      const col = i % cols
      const distance = (col - midCol) ** 2 + ((i - col) / cols - midRow) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    const col = best % cols
    rooms.push({
      areaM2: tail * cellM * cellM,
      x: grid.originX + (col + 0.5) * cellM,
      y: grid.originY + ((best - col) / cols + 0.5) * cellM,
    })
  }
  return { rooms, roomOf }
}

/** Which steps between neighbouring cell centres touch one of the floor's walls. */
interface WallSteps {
  /** The step from cell i to its right neighbour touches a wall. */
  blockedRight: Uint8Array
  /** The step from cell i to the cell below touches a wall. */
  blockedDown: Uint8Array
}

function wallSteps(floor: Floor, grid: Grid): WallSteps {
  const { cols, rows, cellM } = grid
  const blockedRight = new Uint8Array(cols * rows)
  const blockedDown = new Uint8Array(cols * rows)
  const nodes = new Map(floor.nodes.map((node) => [node.id, node]))
  const clampCol = (col: number) => Math.min(Math.max(col, 0), cols - 1)
  const clampRow = (row: number) => Math.min(Math.max(row, 0), rows - 1)
  const centre = (col: number, row: number): Point => ({
    x: grid.originX + (col + 0.5) * cellM,
    y: grid.originY + (row + 0.5) * cellM,
  })

  for (const wall of floor.walls) {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    if (!a || !b) continue
    // Cells whose centre or right/lower neighbour's centre could touch the wall.
    const col0 = clampCol(
      Math.floor((Math.min(a.x, b.x) - grid.originX) / cellM) - 1,
    )
    const col1 = clampCol(
      Math.ceil((Math.max(a.x, b.x) - grid.originX) / cellM) + 1,
    )
    const row0 = clampRow(
      Math.floor((Math.min(a.y, b.y) - grid.originY) / cellM) - 1,
    )
    const row1 = clampRow(
      Math.ceil((Math.max(a.y, b.y) - grid.originY) / cellM) + 1,
    )
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const i = row * cols + col
        const here = centre(col, row)
        if (col + 1 < cols && segmentsTouch(a, b, here, centre(col + 1, row))) {
          blockedRight[i] = 1
        }
        if (row + 1 < rows && segmentsTouch(a, b, here, centre(col, row + 1))) {
          blockedDown[i] = 1
        }
      }
    }
  }

  return { blockedRight, blockedDown }
}

const EPSILON = 1e-9

/** Twice the signed area of triangle pqr; its sign says which side r is on. */
function cross(p: Point, q: Point, r: Point): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
}

/** Whether r, known to be collinear with pq, lies within pq's bounding box. */
function within(p: Point, q: Point, r: Point): boolean {
  return (
    Math.min(p.x, q.x) - EPSILON <= r.x &&
    r.x <= Math.max(p.x, q.x) + EPSILON &&
    Math.min(p.y, q.y) - EPSILON <= r.y &&
    r.y <= Math.max(p.y, q.y) + EPSILON
  )
}

/** Whether segments ab and cd cross or touch, endpoints included. */
export function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
    ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  ) {
    return true
  }
  return (
    (Math.abs(d1) <= EPSILON && within(c, d, a)) ||
    (Math.abs(d2) <= EPSILON && within(c, d, b)) ||
    (Math.abs(d3) <= EPSILON && within(a, b, c)) ||
    (Math.abs(d4) <= EPSILON && within(a, b, d))
  )
}

export interface CoverageSummary {
  /** Floor area inside the walls, in m². Zero when no outline is closed. */
  areaM2: number
  /** Part of that area at or above the target, in m². */
  coveredM2: number
  /** coveredM2 / areaM2, from 0 to 1, or undefined when there is no area. */
  share: number | undefined
}

/**
 * How much of the floor inside the walls gets at least `minDbm`. Cells
 * outside the walls don't count, however strong their signal.
 */
export function summariseCoverage(
  coverage: Coverage,
  minDbm: number,
): CoverageSummary {
  const { dbm, floorArea, grid } = coverage
  let area = 0
  let covered = 0
  for (let i = 0; i < floorArea.length; i++) {
    if (!floorArea[i]) continue
    area++
    if (dbm[i]! >= minDbm) covered++
  }
  const cellArea = grid.cellM * grid.cellM
  return {
    areaM2: area * cellArea,
    coveredM2: covered * cellArea,
    share: area === 0 ? undefined : covered / area,
  }
}
