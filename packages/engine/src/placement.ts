import {
  type AccessPoint,
  type Band,
  type Plan,
  type Point,
} from '@signalplan/floorplan'
import {
  gridForFloor,
  RECEIVER_HEIGHT_M,
  signalDbm,
  type Grid,
} from './coverage.ts'
import { preparedWallLoss } from './crossings.ts'
import { floorAreaMask } from './floorArea.ts'
import { crossingLossDb, floorCrossing, prepareStack } from './floors.ts'

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
  band: Band
  /** The coverage target in dBm: a cell counts when its signal reaches it. */
  minDbm: number
  /**
   * Access points that stay where they are (locked, or not being moved), on
   * any floor.
   */
  fixed: readonly AccessPoint[]
  /** What a moving access point is like: its height and its radio's power. */
  template: AccessPointTemplate
  cellM?: number
}

/** What an access point is like, wherever it goes. */
export type AccessPointTemplate = Pick<AccessPoint, 'heightM' | 'radios'>

/** A position for an access point: a point on one floor (D55). */
export type Spot = Point & { floorId: string }

/** One floor's part of the scored cells. */
export interface ScoredFloor {
  floorId: string
  grid: Grid
  /** Index of its first cell among all the scorer's cells, and how many. */
  start: number
  cellCount: number
}

/**
 * Scores placements of moving access points across the whole home (D40,
 * D41, D55): the floor area of every floor together, so each floor counts by
 * its area. Everything that doesn't depend on where they go is worked out
 * once: the floor area cells, the prepared walls and the fixed access
 * points' signal. Only cells inside the walls are evaluated.
 */
export interface Scorer {
  /** The floors with floor area, from the lowest up. */
  floors: readonly ScoredFloor[]
  /** Number of cells inside the walls on every floor, and their area in m². */
  cellCount: number
  areaM2: number
  /** Whether an access point may go here: inside the walls, clear of them. */
  allows(at: Spot): boolean
  /**
   * Signal in dBm at each floor-area cell, in order, from a moving access
   * point at this position: one like `template`, or like the problem's
   * template if none is given. Empty if it has no radio in the band.
   */
  signal(at: Spot, template?: AccessPointTemplate): Float32Array
  /**
   * Share of the floor area at or above the target, from 0 to 1, with the
   * fixed access points plus moving ones with these signals.
   */
  share(signals: readonly Float32Array[]): number
  /** The share plus the weakest cell's signal, for breaking ties (D42). */
  score(signals: readonly Float32Array[]): PlacementScore
  /** The share of each floor in `floors`, in the same order. */
  floorShares(signals: readonly Float32Array[]): number[]
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

/** The scorer for a problem, or undefined when no floor has a closed outline. */
export function createScorer(problem: PlacementProblem): Scorer | undefined {
  const { plan, band, minDbm, fixed, template } = problem
  const cellM = problem.cellM ?? SEARCH_CELL_M
  const stack = prepareStack(plan, band)
  const storeyOf = new Map(stack.map((storey, i) => [storey.floor.id, i]))

  // Candidates lie inside the walls, so the walls alone set each grid.
  const floors: (ScoredFloor & {
    storey: number
    mask: Uint8Array
    receiverZ: number
    wallEnds: { a: Point; b: Point }[]
  })[] = []
  const xs: number[] = []
  const ys: number[] = []
  stack.forEach(({ floor }, storey) => {
    const grid = gridForFloor(floor, cellM)
    const mask = floorAreaMask(floor, grid)
    const start = xs.length
    mask.forEach((inside, i) => {
      if (!inside) return
      xs.push(grid.originX + ((i % grid.cols) + 0.5) * grid.cellM)
      ys.push(grid.originY + (Math.floor(i / grid.cols) + 0.5) * grid.cellM)
    })
    if (xs.length === start) return
    const nodes = new Map(floor.nodes.map((node) => [node.id, node]))
    floors.push({
      floorId: floor.id,
      grid,
      start,
      cellCount: xs.length - start,
      storey,
      mask,
      receiverZ: floor.elevationM + RECEIVER_HEIGHT_M,
      wallEnds: floor.walls.flatMap((wall) => {
        const a = nodes.get(wall.from)
        const b = nodes.get(wall.to)
        return a && b ? [{ a, b }] : []
      }),
    })
  })
  const cellCount = xs.length
  if (cellCount === 0) return undefined
  const cellX = Float64Array.from(xs)
  const cellY = Float64Array.from(ys)
  const byId = new Map(floors.map((f) => [f.floorId, f]))

  /**
   * Signal at every cell from an access point on storey `from`: on its own
   * floor through that floor's walls, exactly as `evaluateCoverage` works it
   * out, and on other floors through slabs and each storey's walls (D51).
   */
  const signalFrom = (
    ap: Pick<AccessPoint, 'x' | 'y' | 'heightM'>,
    radio: AccessPoint['radios'][number],
    from: number,
  ): Float32Array => {
    const out = new Float32Array(cellCount)
    const apZ = stack[from]!.floor.elevationM + ap.heightM
    for (const f of floors) {
      const end = f.start + f.cellCount
      if (f.storey === from) {
        const walls = stack[from]!.walls
        for (let k = f.start; k < end; k++) {
          const x = cellX[k]!
          const y = cellY[k]!
          const loss = preparedWallLoss(walls, ap.x, ap.y, x, y)
          out[k] = signalDbm(ap, radio, x, y, loss)
        }
        continue
      }
      const crossing = floorCrossing(stack, from, apZ, f.storey, f.receiverZ)
      const dz = apZ - f.receiverZ
      for (let k = f.start; k < end; k++) {
        const x = cellX[k]!
        const y = cellY[k]!
        const loss = crossingLossDb(crossing, ap.x, ap.y, x, y)
        out[k] = signalDbm(ap, radio, x, y, loss, dz)
      }
    }
    return out
  }

  // The strongest fixed signal per cell, as in `evaluateCoverage`.
  const base = new Float32Array(cellCount).fill(Number.NEGATIVE_INFINITY)
  for (const ap of fixed) {
    const radio = ap.radios.find((r) => r.band === band)
    const from = storeyOf.get(ap.floorId)
    if (!radio || from === undefined) continue
    const s = signalFrom(ap, radio, from)
    for (let k = 0; k < s.length; k++) if (s[k]! > base[k]!) base[k] = s[k]!
  }

  const radio = template.radios.find((r) => r.band === band)
  /** The strongest signal at cell k. */
  const strongest = (signals: readonly Float32Array[], k: number) => {
    let best = base[k]!
    for (const s of signals) if (s.length > 0 && s[k]! > best) best = s[k]!
    return best
  }

  return {
    floors: floors.map(({ floorId, grid, start, cellCount: count }) => ({
      floorId,
      grid,
      start,
      cellCount: count,
    })),
    cellCount,
    areaM2: cellCount * cellM * cellM,
    allows(at) {
      const f = byId.get(at.floorId)
      if (!f) return false
      const { grid } = f
      const col = Math.floor((at.x - grid.originX) / grid.cellM)
      const row = Math.floor((at.y - grid.originY) / grid.cellM)
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
        return false
      }
      if (!f.mask[row * grid.cols + col]) return false
      return f.wallEnds.every(
        ({ a, b }) => distanceToSegment(at, a, b) >= WALL_CLEARANCE_M,
      )
    },
    signal(at, like) {
      const r = like ? like.radios.find((x) => x.band === band) : radio
      const from = storeyOf.get(at.floorId)
      if (!r || from === undefined) return new Float32Array(0)
      const heightM = (like ?? template).heightM
      return signalFrom({ x: at.x, y: at.y, heightM }, r, from)
    },
    share(signals) {
      return this.score(signals).share
    },
    score(signals) {
      let covered = 0
      let weakest = Number.POSITIVE_INFINITY
      for (let k = 0; k < cellCount; k++) {
        const best = strongest(signals, k)
        if (best >= minDbm) covered++
        if (best < weakest) weakest = best
      }
      return { share: covered / cellCount, weakestDbm: weakest }
    },
    floorShares(signals) {
      return floors.map((f) => {
        let covered = 0
        for (let k = f.start; k < f.start + f.cellCount; k++) {
          if (strongest(signals, k) >= minDbm) covered++
        }
        return covered / f.cellCount
      })
    },
  }
}

/**
 * The first positions to try (D41): on each floor with floor area, from the
 * lowest up, points (i + ½, j + ½)·spacing in plan coordinates that the
 * scorer allows, in reading order.
 */
export function candidatePositions(
  scorer: Scorer,
  spacingM = CANDIDATE_SPACING_M,
): Spot[] {
  const spots: Spot[] = []
  for (const { floorId, grid } of scorer.floors) {
    const x0 = grid.originX
    const y0 = grid.originY
    const x1 = x0 + grid.cols * grid.cellM
    const y1 = y0 + grid.rows * grid.cellM
    for (
      let j = Math.ceil(y0 / spacingM - 0.5);
      (j + 0.5) * spacingM < y1;
      j++
    ) {
      for (
        let i = Math.ceil(x0 / spacingM - 0.5);
        (i + 0.5) * spacingM < x1;
        i++
      ) {
        const at = {
          x: (i + 0.5) * spacingM,
          y: (j + 0.5) * spacingM,
          floorId,
        }
        if (scorer.allows(at)) spots.push(at)
      }
    }
  }
  return spots
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
