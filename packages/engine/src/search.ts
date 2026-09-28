import type { Point } from '@signalplan/floorplan'
import {
  betterScore,
  candidatePositions,
  createScorer,
  type PlacementProblem,
  type PlacementScore,
  type Scorer,
} from './placement.ts'
import { DEFAULT_CELL_M } from './coverage.ts'

/** A search stops within this long and returns its best result (D40). */
export const SEARCH_BUDGET_MS = 10_000

/** How many of the best lattice positions are refined (D42). */
export const REFINE_COUNT = 5

/** Refining steps, in metres: half the lattice spacing, then 10 cm (D42). */
export const REFINE_STEPS_M = [0.25, 0.1] as const

export interface SearchOptions {
  /** Called with the share of the work done so far, from 0 to 1. */
  onProgress?: (fraction: number) => void
  budgetMs?: number
  /** The clock, in milliseconds; injectable for tests. */
  now?: () => number
}

export type SearchResult =
  | {
      kind: 'found'
      /** Where the access point should go. */
      position: Point
      /** Share of the floor at the target with it there, on 10 cm cells. */
      share: number
      /** The weakest signal inside the walls with it there, in dBm. */
      weakestDbm: number
      /** The same share with it at `problem.current`, if given. */
      before: number | undefined
      /** True if the time budget ran out and the search stopped early. */
      stoppedEarly: boolean
    }
  | { kind: 'no-floor-area' }
  | { kind: 'no-radio' }

export interface SinglePlacementProblem extends PlacementProblem {
  /** Where the access point being placed is now, for the before figure. */
  current?: Point
}

/**
 * Finds the best spot for one moving access point, with the fixed ones in
 * place (D42): score every lattice candidate on 25 cm cells, refine the best
 * few by pattern search down to 10 cm, then pick the winner on 10 cm cells so
 * its share matches the coverage summary.
 */
export function searchSinglePlacement(
  problem: SinglePlacementProblem,
  options: SearchOptions = {},
): SearchResult {
  if (!problem.template.radios.some((r) => r.band === problem.band)) {
    return { kind: 'no-radio' }
  }
  const coarse = createScorer(problem)
  if (!coarse) return { kind: 'no-floor-area' }

  const now = options.now ?? (() => Date.now())
  const deadline = now() + (options.budgetMs ?? SEARCH_BUDGET_MS)
  let stoppedEarly = false
  const outOfTime = () => {
    if (!stoppedEarly && now() > deadline) stoppedEarly = true
    return stoppedEarly
  }

  const candidates = candidatePositions(coarse)
  // Rough work units: each lattice point, each refinement, the final check.
  const refineWork = REFINE_COUNT * REFINE_STEPS_M.length * 8
  const total = candidates.length + refineWork + REFINE_COUNT
  let done = 0
  const progress = (units: number) => {
    done += units
    options.onProgress?.(Math.min(done / total, 1))
  }

  const scored: Scored[] = []
  for (const at of candidates) {
    if (outOfTime()) break
    scored.push({ at, ...coarse.score([coarse.signal(at)]) })
    progress(1)
  }
  if (scored.length === 0 && candidates[0]) {
    // Even out of time, have something to show.
    const at = candidates[0]
    scored.push({ at, ...coarse.score([coarse.signal(at)]) })
  }
  // Stable sort: full ties keep reading order, so results are reproducible.
  scored.sort((a, b) => (betterScore(a, b) ? -1 : betterScore(b, a) ? 1 : 0))
  const seeds = scored.slice(0, REFINE_COUNT)

  const refined = seeds.map((seed) => {
    let best = seed
    for (const step of REFINE_STEPS_M) {
      best = patternSearch(coarse, best, step, outOfTime)
      progress(8)
    }
    return best
  })

  const fine = createScorer({ ...problem, cellM: DEFAULT_CELL_M })!
  let winner: Scored | undefined
  for (const { at } of refined) {
    const score = { at, ...fine.score([fine.signal(at)]) }
    if (!winner || betterScore(score, winner)) winner = score
    progress(1)
  }
  options.onProgress?.(1)

  if (!winner) return { kind: 'no-floor-area' }
  return {
    kind: 'found',
    position: winner.at,
    share: winner.share,
    weakestDbm: winner.weakestDbm,
    before: problem.current
      ? fine.share([fine.signal(problem.current)])
      : undefined,
    stoppedEarly,
  }
}

type Scored = PlacementScore & { at: Point }

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

/**
 * Moves to the best of the 8 neighbours `step` away while that improves the
 * score, trying only positions the scorer allows.
 */
function patternSearch(
  scorer: Scorer,
  start: Scored,
  step: number,
  outOfTime: () => boolean,
): Scored {
  let best = start
  for (;;) {
    let next = best
    for (const [dx, dy] of DIRECTIONS) {
      if (outOfTime()) return best
      const at = {
        x: round(best.at.x + dx * step),
        y: round(best.at.y + dy * step),
      }
      if (!scorer.allows(at)) continue
      const score = { at, ...scorer.score([scorer.signal(at)]) }
      if (betterScore(score, next)) next = score
    }
    if (next === best) return best
    best = next
  }
}

/** Rounds to 0.1 mm so repeated steps don't drift. */
function round(value: number): number {
  return Math.round(value * 1e4) / 1e4
}
