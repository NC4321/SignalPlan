import {
  DEFAULT_FLOOR_MATERIAL,
  materialSegments,
  pointInPolygon,
  stackedFloors,
  type Band,
  type Floor,
  type Plan,
  type Point,
} from '@signalplan/floorplan'
import {
  prepareWalls,
  preparedWallLoss,
  type PreparedWalls,
} from './crossings.ts'
import { FLOOR_LOSS_DB, MATERIAL_LOSS_DB } from './materials.ts'

/**
 * One storey of a plan in one band: where its rooms sit in height, the loss
 * of its slab and its walls, ready for many paths.
 */
export interface Storey {
  floor: Floor
  /** Height of the floor's surface: the top of its slab. */
  bottomM: number
  /**
   * Height of its ceiling, never above the next storey's surface. Between
   * the two lies the slab of the storey above.
   */
  topM: number
  /** Loss in dB through this floor's slab, head-on (D50). */
  slabLossDb: number
  /** Holes in the slab, such as stairwells, that cost nothing (D54). */
  holes: SlabHoles | undefined
  walls: PreparedWalls
}

/** A slab's openings, with a bounding box to skip most points quickly. */
export interface SlabHoles {
  polygons: readonly (readonly Point[])[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function prepareHoles(floor: Floor): SlabHoles | undefined {
  const polygons = (floor.floorOpenings ?? []).map((o) => o.points)
  if (polygons.length === 0) return undefined
  const points = polygons.flat()
  return {
    polygons,
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

/** Whether a point on the plan lies in one of a slab's holes. */
export function inHole(holes: SlabHoles, x: number, y: number): boolean {
  if (x < holes.minX || x > holes.maxX || y < holes.minY || y > holes.maxY) {
    return false
  }
  const p = { x, y }
  return holes.polygons.some((polygon) => pointInPolygon(p, polygon))
}

/**
 * The plan's floors in one band, from the lowest up. Floors at the same
 * elevation keep the plan's order.
 */
export function prepareStack(plan: Plan, band: Band): Storey[] {
  const wallLosses = MATERIAL_LOSS_DB[band]
  const slabLosses = FLOOR_LOSS_DB[band]
  const floors = stackedFloors(plan.floors)
  return floors.map((floor, i) => {
    const next = floors[i + 1]
    const ceiling = floor.elevationM + floor.heightM
    return {
      floor,
      bottomM: floor.elevationM,
      topM: next ? Math.min(ceiling, next.elevationM) : ceiling,
      slabLossDb: slabLosses[floor.material ?? DEFAULT_FLOOR_MATERIAL],
      holes: prepareHoles(floor),
      walls: prepareWalls(materialSegments(floor), (m) => wallLosses[m]),
    }
  })
}

/** Where a path's stretch through one storey starts and ends, from 0 to 1. */
export interface StoreyStretch {
  walls: PreparedWalls
  fromT: number
  toT: number
}

/**
 * A straight path from a point in one storey to a point in another, at
 * heights `fromZ` and `toZ` above the lowest floor (D51). It pays the slab of
 * every storey boundary it crosses, and each storey's walls along the stretch
 * of the path inside that storey, between its surface and its ceiling. Every
 * slab covers the whole plan except its openings (D54): where the path
 * passes through the slab's middle height inside one, that slab costs nothing.
 *
 * The stretches depend only on the heights, so a grid of cells at one height
 * shares them. A path that doesn't rise from storey to storey as it should
 * (an access point mounted above the next floor up) splits halfway.
 */
export interface FloorCrossing {
  /** Total loss of the slabs crossed that have no openings, in dB. */
  slabLossDb: number
  /**
   * Slabs crossed that have openings, with where along the path (0 to 1) it
   * passes their middle height.
   */
  holedSlabs: { holes: SlabHoles; lossDb: number; t: number }[]
  /** One stretch per storey, from the start's storey to the end's. */
  stretches: StoreyStretch[]
}

export function floorCrossing(
  stack: readonly Storey[],
  from: number,
  fromZ: number,
  to: number,
  toZ: number,
): FloorCrossing {
  const step = to > from ? 1 : -1
  const rise = (toZ - fromZ) * step
  // Where the path's height reaches z, from 0 at the start to 1 at the end.
  const at = (z: number) =>
    rise > 0 ? Math.min(Math.max((z - fromZ) / (toZ - fromZ), 0), 1) : 0.5

  let slabLossDb = 0
  const holedSlabs: FloorCrossing['holedSlabs'] = []
  const stretches: StoreyStretch[] = []
  let enter = 0
  for (let i = from; i !== to; i += step) {
    const here = stack[i]!
    const next = stack[i + step]!
    // Leaving through the ceiling going up, or the surface going down.
    const exit = Math.max(enter, at(step > 0 ? here.topM : here.bottomM))
    stretches.push({ walls: here.walls, fromT: enter, toT: exit })
    enter = Math.max(exit, at(step > 0 ? next.bottomM : next.topM))
    // Going up crosses the next storey's slab; going down, this one's.
    const slab = step > 0 ? next : here
    if (slab.holes) {
      holedSlabs.push({
        holes: slab.holes,
        lossDb: slab.slabLossDb,
        t: (exit + enter) / 2,
      })
    } else {
      slabLossDb += slab.slabLossDb
    }
  }
  stretches.push({ walls: stack[to]!.walls, fromT: enter, toT: 1 })
  return { slabLossDb, holedSlabs, stretches }
}

/**
 * Total loss in dB along a path whose heights gave `crossing`: its slabs,
 * then each storey's walls along its stretch, in order.
 */
export function crossingLossDb(
  crossing: FloorCrossing,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const dx = toX - fromX
  const dy = toY - fromY
  let total = crossing.slabLossDb
  for (const { holes, lossDb, t } of crossing.holedSlabs) {
    if (!inHole(holes, fromX + t * dx, fromY + t * dy)) total += lossDb
  }
  for (const { walls, fromT, toT } of crossing.stretches) {
    if (toT <= fromT) continue
    total += preparedWallLoss(
      walls,
      fromX + fromT * dx,
      fromY + fromT * dy,
      fromX + toT * dx,
      fromY + toT * dy,
    )
  }
  return total
}
