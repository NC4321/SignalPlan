import {
  materialSegments,
  type AccessPoint,
  type Band,
  type Plan,
  type Point,
} from '@signalplan/floorplan'
import { gridForFloor, signalDbm, type Grid } from './coverage.ts'
import { prepareWalls, preparedWallLoss } from './crossings.ts'
import { floorAreaMask } from './floorArea.ts'
import { MATERIAL_LOSS_DB } from './materials.ts'

/** Cell size while searching (D41): 25 cm, confirmed at 10 cm afterwards. */
export const SEARCH_CELL_M = 0.25

/** Spacing of the first candidate positions tried (D41). */
export const CANDIDATE_SPACING_M = 0.5

/**
 * The closest a candidate may be to a wall, in metres (D41). Walls are thin
 * lines, so a position on one would be on neither side; 10 cm is an access
 * point standing against the wall.
 */
export const WALL_CLEARANCE_M = 0.1

export interface PlacementProblem {
  plan: Plan
  floorId: string
  band: Band
  /** The coverage target in dBm: a cell counts when its signal reaches it. */
  minDbm: number
  /** Access points that stay where they are (locked, or not being moved). */
  fixed: readonly AccessPoint[]
  /** What a moving access point is like: its height and its radio's power. */
  template: AccessPointTemplate
  cellM?: number
}

/** What an access point is like, wherever it goes. */
export type AccessPointTemplate = Pick<AccessPoint, 'heightM' | 'radios'>

/**
 * Scores placements of moving access points against a fixed floor (D40,
 * D41). Everything that doesn't depend on where they go is worked out once:
 * the floor area cells, the prepared walls and the fixed access points'
 * signal. Only cells inside the walls are evaluated.
 */
export interface Scorer {
  grid: Grid
  /** Number of cells inside the walls, and their area in m². */
  cellCount: number
  areaM2: number
  /** Whether an access point may go here: inside the walls, clear of them. */
  allows(at: Point): boolean
  /**
   * Signal in dBm at each floor-area cell, in order, from a moving access
   * point at this position: one like `template`, or like the problem's
   * template if none is given. Empty if it has no radio in the band.
   */
  signal(at: Point, template?: AccessPointTemplate): Float32Array
  /**
   * Share of the floor area at or above the target, from 0 to 1, with the
   * fixed access points plus moving ones with these signals.
   */
  share(signals: readonly Float32Array[]): number
  /** The share plus the weakest cell's signal, for breaking ties (D42). */
  score(signals: readonly Float32Array[]): PlacementScore
}

export interface PlacementScore {
  share: number
  /** The weakest signal in dBm anywhere inside the walls. */
  weakestDbm: number
}

/**
 * Whether score a beats score b: a larger share wins, and on an equal share
 * the stronger weakest spot, which leaves the most headroom (D42).
 */
export function betterScore(a: PlacementScore, b: PlacementScore): boolean {
  return (
    a.share > b.share || (a.share === b.share && a.weakestDbm > b.weakestDbm)
  )
}

/** The scorer for a problem, or undefined when the floor has no closed outline. */
export function createScorer(problem: PlacementProblem): Scorer | undefined {
  const { plan, floorId, band, minDbm, fixed, template } = problem
  const floor = plan.floors.find((f) => f.id === floorId)
  if (!floor) throw new RangeError(`No floor with id "${floorId}".`)

  // Candidates lie inside the walls, so the walls alone set the grid.
  const grid = gridForFloor(floor, problem.cellM ?? SEARCH_CELL_M)
  const mask = floorAreaMask(floor, grid)
  const cells: number[] = []
  mask.forEach((inside, i) => {
    if (inside) cells.push(i)
  })
  if (cells.length === 0) return undefined

  const cellX = new Float64Array(cells.length)
  const cellY = new Float64Array(cells.length)
  cells.forEach((i, k) => {
    cellX[k] = grid.originX + ((i % grid.cols) + 0.5) * grid.cellM
    cellY[k] = grid.originY + (Math.floor(i / grid.cols) + 0.5) * grid.cellM
  })

  const segments = materialSegments(floor)
  const losses = MATERIAL_LOSS_DB[band]
  const walls = prepareWalls(segments, (material) => losses[material])

  const signalFrom = (
    ap: Pick<AccessPoint, 'x' | 'y' | 'heightM'>,
    radio: AccessPoint['radios'][number],
  ): Float32Array => {
    const out = new Float32Array(cells.length)
    for (let k = 0; k < cells.length; k++) {
      const loss = preparedWallLoss(walls, ap.x, ap.y, cellX[k]!, cellY[k]!)
      out[k] = signalDbm(ap, radio, cellX[k]!, cellY[k]!, loss)
    }
    return out
  }

  // The strongest fixed signal per cell, as in `evaluateCoverage`.
  const base = new Float32Array(cells.length).fill(Number.NEGATIVE_INFINITY)
  for (const ap of fixed) {
    const radio = ap.radios.find((r) => r.band === band)
    if (ap.floorId !== floorId || !radio) continue
    const s = signalFrom(ap, radio)
    for (let k = 0; k < s.length; k++) if (s[k]! > base[k]!) base[k] = s[k]!
  }

  const radio = template.radios.find((r) => r.band === band)
  const nodes = new Map(floor.nodes.map((node) => [node.id, node]))
  const wallEnds = floor.walls.flatMap((wall) => {
    const a = nodes.get(wall.from)
    const b = nodes.get(wall.to)
    return a && b ? [{ a, b }] : []
  })

  return {
    grid,
    cellCount: cells.length,
    areaM2: cells.length * grid.cellM * grid.cellM,
    allows(at) {
      const col = Math.floor((at.x - grid.originX) / grid.cellM)
      const row = Math.floor((at.y - grid.originY) / grid.cellM)
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
        return false
      }
      if (!mask[row * grid.cols + col]) return false
      return wallEnds.every(
        ({ a, b }) => distanceToSegment(at, a, b) >= WALL_CLEARANCE_M,
      )
    },
    signal(at, like) {
      const r = like ? like.radios.find((x) => x.band === band) : radio
      if (!r) return new Float32Array(0)
      const heightM = (like ?? template).heightM
      return signalFrom({ x: at.x, y: at.y, heightM }, r)
    },
    share(signals) {
      return this.score(signals).share
    },
    score(signals) {
      let covered = 0
      let weakest = Number.POSITIVE_INFINITY
      for (let k = 0; k < cells.length; k++) {
        let best = base[k]!
        for (const s of signals) if (s.length > 0 && s[k]! > best) best = s[k]!
        if (best >= minDbm) covered++
        if (best < weakest) weakest = best
      }
      return { share: covered / cells.length, weakestDbm: weakest }
    },
  }
}

/**
 * The first positions to try (D41): points (i + ½, j + ½)·spacing in plan
 * coordinates that the scorer allows, in reading order.
 */
export function candidatePositions(
  scorer: Scorer,
  spacingM = CANDIDATE_SPACING_M,
): Point[] {
  const { grid } = scorer
  const x0 = grid.originX
  const y0 = grid.originY
  const x1 = x0 + grid.cols * grid.cellM
  const y1 = y0 + grid.rows * grid.cellM
  const points: Point[] = []
  for (let j = Math.ceil(y0 / spacingM - 0.5); (j + 0.5) * spacingM < y1; j++) {
    for (
      let i = Math.ceil(x0 / spacingM - 0.5);
      (i + 0.5) * spacingM < x1;
      i++
    ) {
      const at = { x: (i + 0.5) * spacingM, y: (j + 0.5) * spacingM }
      if (scorer.allows(at)) points.push(at)
    }
  }
  return points
}

/** Distance from p to segment ab. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const sx = b.x - a.x
  const sy = b.y - a.y
  const lengthSq = sx * sx + sy * sy
  const t =
    lengthSq === 0
      ? 0
      : Math.min(
          Math.max(((p.x - a.x) * sx + (p.y - a.y) * sy) / lengthSq, 0),
          1,
        )
  return Math.hypot(p.x - (a.x + t * sx), p.y - (a.y + t * sy))
}
