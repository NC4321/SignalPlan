import { polygonArea, type Point } from './geometry.ts'
import type { Floor, FloorOpening } from './schema.ts'

/**
 * Editing operations on a floor's openings in its slab: stairwells and
 * atriums (D54). Like those in `edit.ts`, each mutates the floor it is given,
 * so it works on an Immer draft as well.
 */

/** Openings smaller than this are a slip of the mouse, in m². */
export const MIN_FLOOR_OPENING_AREA_M2 = 0.01

function find(floor: Floor, id: string): FloorOpening {
  const opening = floor.floorOpenings?.find((o) => o.id === id)
  if (!opening) throw new Error(`No floor opening with id "${id}".`)
  return opening
}

/**
 * Adds an opening with these corners, in order, and returns its id; or
 * returns undefined, adding nothing, when it has fewer than three corners or
 * almost no area.
 */
export function addFloorOpening(
  floor: Floor,
  points: readonly Point[],
): string | undefined {
  if (points.length < 3 || polygonArea(points) < MIN_FLOOR_OPENING_AREA_M2) {
    return undefined
  }
  const list = (floor.floorOpenings ??= [])
  const used = new Set(list.map((o) => o.id))
  let n = 1
  while (used.has(`hole${n}`)) n++
  const id = `hole${n}`
  list.push({ id, points: points.map(({ x, y }) => ({ x, y })) })
  return id
}

/** Moves a whole opening by (dx, dy). */
export function moveFloorOpening(
  floor: Floor,
  id: string,
  dx: number,
  dy: number,
) {
  for (const point of find(floor, id).points) {
    point.x += dx
    point.y += dy
  }
}

/**
 * Moves one corner of an opening to a point, unless that would leave it with
 * almost no area. Returns whether it moved.
 */
export function moveFloorOpeningCorner(
  floor: Floor,
  id: string,
  index: number,
  to: Point,
): boolean {
  const opening = find(floor, id)
  const point = opening.points[index]
  if (!point) throw new RangeError(`No corner ${index} on "${id}".`)
  const moved = opening.points.map((p, i) => (i === index ? to : p))
  if (polygonArea(moved) < MIN_FLOOR_OPENING_AREA_M2) return false
  point.x = to.x
  point.y = to.y
  return true
}

/** Deletes an opening; returns whether there was one. */
export function deleteFloorOpening(floor: Floor, id: string): boolean {
  const list = floor.floorOpenings
  const i = list?.findIndex((o) => o.id === id) ?? -1
  if (!list || i < 0) return false
  list.splice(i, 1)
  if (list.length === 0) delete floor.floorOpenings
  return true
}
