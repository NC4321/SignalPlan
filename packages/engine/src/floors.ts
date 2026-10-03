import {
  DEFAULT_FLOOR_MATERIAL,
  materialSegments,
  pointInPolygon,
  stackedFloors,
  type Band,
  type BandCalibration,
  type Floor,
  type FloorMaterial,
  type Plan,
  type Point,
} from '@signalplan/floorplan'
import {
  indexedWallLoss,
  indexWalls,
  prepareWalls,
  preparedWallLoss,
  type PreparedWalls,
  type WallIndex,
} from './crossings.ts'
import {
  floorLossAtDb,
  floorLossTable,
  MATERIAL_LOSS_DB,
  type FloorLossTable,
} from './materials.ts'

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
  /** Loss in dB through this floor's slab by angle (D50, D60). */
  slabLoss: FloorLossTable
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
 * A floor's loss table in one band, scaled so its head-on loss is the
 * calibrated one if there is one (D75).
 */
export function slabLossTable(
  band: Band,
  material: FloorMaterial,
  calibration?: BandCalibration,
): FloorLossTable {
  const table = floorLossTable(band, material)
  const headOn = calibration?.floorLossDb?.[material]
  if (headOn === undefined) return table
  const scale = headOn / table[0]!
  return table.map((loss) => loss * scale)
}

/**
 * The plan's floors in one band, from the lowest up. Floors at the same
 * elevation keep the plan's order. Calibrated losses replace the defaults
 * where given (D75): the plan's own (D76) unless others are passed, and `{}`
 * gives the defaults.
 */
export function prepareStack(
  plan: Plan,
  band: Band,
  calibration: BandCalibration | undefined = plan.calibration?.[band],
): Storey[] {
  const wallLosses = { ...MATERIAL_LOSS_DB[band], ...calibration?.wallLossDb }
  const floors = stackedFloors(plan.floors)
  return floors.map((floor, i) => {
    const next = floors[i + 1]
    const ceiling = floor.elevationM + floor.heightM
    return {
      floor,
      bottomM: floor.elevationM,
      topM: next ? Math.min(ceiling, next.elevationM) : ceiling,
      slabLoss: slabLossTable(
        band,
        floor.material ?? DEFAULT_FLOOR_MATERIAL,
        calibration,
      ),
      holes: prepareHoles(floor),
      walls: prepareWalls(materialSegments(floor), (m) => wallLosses[m]),
    }
  })
}

/** Where a path's stretch through one storey starts and ends, from 0 to 1. */
export interface StoreyStretch {
  walls: PreparedWalls
  /** The walls sorted by direction from the path's start, if given (D56). */
  index: WallIndex | undefined
  fromT: number
  toT: number
}

/**
 * A straight path from a point in one storey to a point in another, at
 * heights `fromZ` and `toZ` above the lowest floor (D51). It pays the slab of
 * every storey boundary it crosses, and each storey's walls along the stretch
 * of the path inside that storey, between its surface and its ceiling. A
 * slab's loss follows the path's angle from the vertical, up to a cap (D60).
 * Every
 * slab covers the whole plan except its openings (D54): where the path
 * passes through the slab's middle height inside one, that slab costs nothing.
 *
 * The stretches depend only on the heights, so a grid of cells at one height
 * shares them. A path that doesn't rise from storey to storey as it should
 * (an access point mounted above the next floor up) splits halfway.
 */
export interface FloorCrossing {
  /** How far the path rises or falls, in metres, for the slabs' angle. */
  riseM: number
  /** Total loss of the slabs crossed that have no openings, by angle. */
  slabLoss: FloorLossTable
  /**
   * Slabs crossed that have openings, with where along the path (0 to 1) it
   * passes their middle height.
   */
  holedSlabs: { holes: SlabHoles; loss: FloorLossTable; t: number }[]
  /** One stretch per storey, from the start's storey to the end's. */
  stretches: StoreyStretch[]
  /**
   * Every slab crossed, as the index in the stack of the storey whose slab
   * it is, with where along the path it passes the slab's middle height.
   */
  slabs: { storey: number; t: number }[]
}

const NO_SLAB: FloorLossTable = [0, 0]

export function floorCrossing(
  stack: readonly Storey[],
  from: number,
  fromZ: number,
  to: number,
  toZ: number,
  /**
   * Where every path with these heights starts on the plan, such as an
   * access point, if they all do: each storey's walls are then sorted by
   * direction from there, which gives the same losses faster (D56).
   */
  origin?: Point,
): FloorCrossing {
  const indexOf = (walls: PreparedWalls) =>
    origin && indexWalls(walls, origin.x, origin.y)
  const step = to > from ? 1 : -1
  const rise = (toZ - fromZ) * step
  // Where the path's height reaches z, from 0 at the start to 1 at the end.
  const at = (z: number) =>
    rise > 0 ? Math.min(Math.max((z - fromZ) / (toZ - fromZ), 0), 1) : 0.5

  let slabLoss: number[] | undefined
  const holedSlabs: FloorCrossing['holedSlabs'] = []
  const slabs: FloorCrossing['slabs'] = []
  const stretches: StoreyStretch[] = []
  let enter = 0
  for (let i = from; i !== to; i += step) {
    const here = stack[i]!
    const next = stack[i + step]!
    // Leaving through the ceiling going up, or the surface going down.
    const exit = Math.max(enter, at(step > 0 ? here.topM : here.bottomM))
    stretches.push({
      walls: here.walls,
      index: indexOf(here.walls),
      fromT: enter,
      toT: exit,
    })
    enter = Math.max(exit, at(step > 0 ? next.bottomM : next.topM))
    // Going up crosses the next storey's slab; going down, this one's.
    const slab = step > 0 ? next : here
    const t = (exit + enter) / 2
    slabs.push({ storey: step > 0 ? i + 1 : i, t })
    if (slab.holes) {
      holedSlabs.push({ holes: slab.holes, loss: slab.slabLoss, t })
    } else {
      slabLoss = slabLoss
        ? slabLoss.map((loss, i) => loss + slab.slabLoss[i]!)
        : [...slab.slabLoss]
    }
  }
  stretches.push({
    walls: stack[to]!.walls,
    index: indexOf(stack[to]!.walls),
    fromT: enter,
    toT: 1,
  })
  return {
    riseM: Math.abs(toZ - fromZ),
    slabLoss: slabLoss ?? NO_SLAB,
    holedSlabs,
    stretches,
    slabs,
  }
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
  // Every slab meets the straight path at the same angle.
  const across = Math.hypot(dx, dy)
  let total = floorLossAtDb(crossing.slabLoss, across, crossing.riseM)
  for (const { holes, loss, t } of crossing.holedSlabs) {
    if (!inHole(holes, fromX + t * dx, fromY + t * dy)) {
      total += floorLossAtDb(loss, across, crossing.riseM)
    }
  }
  for (const { walls, index, fromT, toT } of crossing.stretches) {
    if (toT <= fromT) continue
    const x0 = fromX + fromT * dx
    const y0 = fromY + fromT * dy
    const x1 = fromX + toT * dx
    const y1 = fromY + toT * dy
    total += index
      ? indexedWallLoss(index, x0, y0, x1, y1)
      : preparedWallLoss(walls, x0, y0, x1, y1)
  }
  return total
}
