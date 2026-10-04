import {
  DEFAULT_FLOOR_MATERIAL,
  type Floor,
  type FloorMaterial,
  type Plan,
} from './schema.ts'
import { dropOrphanReadings } from './survey.ts'

/**
 * Editing operations on a plan's floors (D52). Like those in `edit.ts`, each
 * mutates the plan it is given, so it works on an Immer draft as well, and
 * keeps the plan valid. Floors stack by elevation (D51); the list order in
 * the plan doesn't matter.
 */

/**
 * Thickness of each floor construction, used to stack a new floor on the one
 * below: the middle 2×10 variant of the timber joist floor (18.3 mm subfloor,
 * 235 mm cavity, 12.7 mm ceiling) and the 150 mm slab (D50).
 */
export const SLAB_THICKNESS_M: Readonly<Record<FloorMaterial, number>> = {
  'timber-joist': 0.266,
  'concrete-slab': 0.15,
}

/** The floors from the lowest up; floors at the same elevation keep plan order. */
export function stackedFloors<F extends Pick<Floor, 'elevationM'>>(
  floors: readonly F[],
): F[] {
  return [...floors].sort((a, b) => a.elevationM - b.elevationM)
}

const slabOf = (floor: Pick<Floor, 'material'>) =>
  SLAB_THICKNESS_M[floor.material ?? DEFAULT_FLOOR_MATERIAL]

function nextFloorId(plan: Plan): string {
  const used = new Set(plan.floors.map((f) => f.id))
  let n = 2
  while (used.has(`floor${n}`)) n++
  return `floor${n}`
}

/** `base`, or `base 2`, `base 3` … whichever no floor is called yet. */
function unusedName(plan: Plan, base: string): string {
  const used = new Set(plan.floors.map((f) => f.name))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * Adds an empty floor on top of the highest one or under the lowest, and
 * returns its id. It copies its neighbour's height. Above, it sits on its own
 * slab over the ceiling below; below, the neighbour's slab lies between them.
 */
export function addFloor(plan: Plan, where: 'above' | 'below'): string {
  const stack = stackedFloors(plan.floors)
  // A plan always has a floor (schema).
  const neighbour = where === 'above' ? stack.at(-1)! : stack[0]!
  const heightM = neighbour.heightM
  const floor: Floor = {
    id: nextFloorId(plan),
    name: unusedName(plan, where === 'above' ? 'Upper floor' : 'Basement'),
    elevationM: 0,
    heightM,
    nodes: [],
    walls: [],
    openings: [],
  }
  floor.elevationM =
    where === 'above'
      ? neighbour.elevationM + neighbour.heightM + slabOf(floor)
      : neighbour.elevationM - slabOf(neighbour) - heightM
  plan.floors.push(floor)
  return floor.id
}

/**
 * Deletes a floor with everything on it, its access points included, and
 * the survey readings taken from them on other floors (D71). The last floor
 * can't be deleted; returns whether it was.
 */
export function deleteFloor(plan: Plan, floorId: string): boolean {
  if (plan.floors.length <= 1) return false
  const before = plan.floors.length
  plan.floors = plan.floors.filter((f) => f.id !== floorId)
  if (plan.floors.length === before) return false
  plan.accessPoints = plan.accessPoints.filter((ap) => ap.floorId !== floorId)
  // A neighbour located on it loses its position and counts everywhere again.
  for (const network of plan.neighbourNetworks ?? []) {
    if (network.location?.floorId === floorId) delete network.location
  }
  dropOrphanReadings(plan)
  return true
}

/**
 * Swaps a floor with the one above or below it in the stack. The lower of
 * the two keeps the lower elevation and the gap between them stays, so the
 * pair spans the same heights as before and no other floor moves. Returns
 * whether it moved: the top floor can't go up, nor the bottom one down.
 */
export function moveFloor(
  plan: Plan,
  floorId: string,
  direction: 'up' | 'down',
): boolean {
  const stack = stackedFloors(plan.floors)
  const i = stack.findIndex((f) => f.id === floorId)
  const j = direction === 'up' ? i + 1 : i - 1
  if (i < 0 || j < 0 || j >= stack.length) return false
  const lower = stack[Math.min(i, j)]!
  const upper = stack[Math.max(i, j)]!
  const gap = Math.max(upper.elevationM - (lower.elevationM + lower.heightM), 0)
  const bottom = lower.elevationM
  upper.elevationM = bottom
  lower.elevationM = bottom + upper.heightM + gap
  return true
}

/**
 * The floor above (`step` 1) or below (−1) a floor in the stack, or undefined
 * at the top or bottom.
 */
export function adjacentFloorId(
  floors: readonly Floor[],
  floorId: string,
  step: 1 | -1,
): string | undefined {
  const stack = stackedFloors(floors)
  const i = stack.findIndex((f) => f.id === floorId)
  return i < 0 ? undefined : stack[i + step]?.id
}
