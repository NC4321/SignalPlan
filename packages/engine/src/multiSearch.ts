import type { AccessPoint, Point } from '@signalplan/floorplan'
import { DEFAULT_CELL_M } from './coverage.ts'
import {
  betterScore,
  candidatePositions,
  createScorer,
  type AccessPointTemplate,
  type PlacementProblem,
  type PlacementScore,
  type Scorer,
} from './placement.ts'
import {
  REFINE_STEPS_M,
  SEARCH_BUDGET_MS,
  type SearchOptions,
} from './search.ts'

/**
 * Annealing steps per moving access point (D45). A fixed count with a fixed
 * seed makes results the same on every device; the time budget only caps it.
 */
export const ANNEAL_STEPS_PER_AP = 250

/** Seed of the annealing's random numbers (D45). */
export const ANNEAL_SEED = 0x5eed

/** Chance that a step jumps to a random lattice candidate (D45). */
export const JUMP_CHANCE = 0.2

/** Step lengths shrink from this to the finest refining step (D45). */
export const ANNEAL_START_STEP_M = 2

export interface MultiPlacementProblem extends PlacementProblem {
  /** Access points that may move, at their current spots (the unlocked ones). */
  moving: readonly AccessPoint[]
  /** How many access points to add; each is like `template`. */
  add: number
}

export type MultiSearchResult =
  | {
      kind: 'found'
      /** New spots for `moving`, in order, then those of the added ones. */
      positions: Point[]
      /** Share of the floor at the target with them there, on 10 cm cells. */
      share: number
      weakestDbm: number
      /** The same with `moving` where they are now and nothing added. */
      before: number
      beforeWeakestDbm: number
      /** True if the time budget ran out and the search stopped early. */
      stoppedEarly: boolean
    }
  | { kind: 'no-floor-area' }
  | { kind: 'no-radio' }
  | { kind: 'nothing-to-place' }

/**
 * Places several access points at once (D45). Added ones go in one at a
 * time at the best remaining lattice spot (greedy), then all moving ones are
 * refined together by simulated annealing and polished by pattern search.
 * The winner is confirmed on 10 cm cells against the greedy layout, so
 * refining never lowers the score.
 */
export function searchMultiPlacement(
  problem: MultiPlacementProblem,
  options: SearchOptions & {
    /** False skips annealing and polishing, for comparing in tests. */
    refine?: boolean
  } = {},
): MultiSearchResult {
  const { moving, add } = problem
  if (moving.length + add === 0) return { kind: 'nothing-to-place' }
  if (add > 0 && !hasRadio(problem)) return { kind: 'no-radio' }
  const session = startSession(problem, options)
  if (!session) return { kind: 'no-floor-area' }

  session.expect(session.latticeWork + session.placeWork(add))
  const placed = session.place(add)
  options.onProgress?.(1)
  return {
    kind: 'found',
    positions: placed.at,
    share: placed.share,
    weakestDbm: placed.weakestDbm,
    before: session.before.share,
    beforeWeakestDbm: session.before.weakestDbm,
    stoppedEarly: session.stoppedEarly(),
  }
}

/** The most access points "How many do I need?" adds (D46). */
export const MAX_ADDED = 4

export interface HowManyProblem extends PlacementProblem {
  /** Access points that may move, at their current spots (the unlocked ones). */
  moving: readonly AccessPoint[]
  /** Share of the floor, from 0 to 1, that should reach the target. */
  goal: number
  /** The most access points to add; `MAX_ADDED` if omitted. */
  maxAdd?: number
}

export type HowManyResult =
  | {
      kind: 'found'
      /** How many access points are added; `positions` ends with theirs. */
      added: number
      /** False if even the most added didn't reach the goal. */
      reached: boolean
      /** New spots for `moving`, in order, then those of the added ones. */
      positions: Point[]
      /** Share of the floor at the target with them there, on 10 cm cells. */
      share: number
      weakestDbm: number
      /** The same with `moving` where they are now and nothing added. */
      before: number
      beforeWeakestDbm: number
      /** True if the time budget ran out and the search stopped early. */
      stoppedEarly: boolean
    }
  | { kind: 'no-floor-area' }
  | { kind: 'no-radio' }

/**
 * The fewest access points that reach the goal (D46). If the ones there
 * already reach it, nothing moves. Otherwise it runs the multi search with
 * 0, 1, 2 … added, up to `maxAdd`, and stops at the first that reaches the
 * goal. The counts share one lattice and one time budget. Each count also
 * starts from the previous count's winner plus one placed greedily, so
 * adding one never lowers the score. If none reaches the goal, the best
 * layout found is returned with `reached: false`.
 */
export function searchHowMany(
  problem: HowManyProblem,
  options: SearchOptions = {},
): HowManyResult {
  const { moving, goal } = problem
  const maxAdd = problem.maxAdd ?? MAX_ADDED
  const session = startSession(problem, options)
  if (!session) return { kind: 'no-floor-area' }
  const { before } = session
  const current = moving.map((ap) => ({ x: ap.x, y: ap.y }))
  const reaches = (share: number) => share >= goal - 1e-9
  const result = (
    added: number,
    placed: { at: Point[] } & PlacementScore,
  ): HowManyResult => {
    options.onProgress?.(1)
    return {
      kind: 'found',
      added,
      reached: reaches(placed.share),
      positions: placed.at,
      share: placed.share,
      weakestDbm: placed.weakestDbm,
      before: before.share,
      beforeWeakestDbm: before.weakestDbm,
      stoppedEarly: session.stoppedEarly(),
    }
  }
  if (reaches(before.share)) return result(0, { at: current, ...before })
  if (!hasRadio(problem) && moving.length === 0) return { kind: 'no-radio' }

  const most = hasRadio(problem) ? maxAdd : 0
  const first = moving.length > 0 ? 0 : 1
  let work = session.latticeWork
  for (let add = first; add <= most; add++) {
    work += session.placeWork(add, add > first)
  }
  session.expect(work)

  let best: ({ at: Point[]; added: number } & PlacementScore) | undefined
  let previous: Point[] | undefined
  for (let add = first; add <= most; add++) {
    const placed = session.place(add, previous)
    // Another access point is only worth it for a larger share: one more
    // always strengthens the weakest spot, so that tie-break doesn't count.
    if (!best || placed.share > best.share) best = { ...placed, added: add }
    if (reaches(placed.share) || session.stoppedEarly()) break
    previous = placed.at
  }
  return result(best!.added, best!)
}

const hasRadio = (problem: PlacementProblem) =>
  problem.template.radios.some((r) => r.band === problem.band)

interface Session {
  /** The moving ones where they are, with nothing added, on 10 cm cells. */
  before: PlacementScore
  /** Work units of the lattice signals, and of placing with `add` added. */
  latticeWork: number
  placeWork: (add: number, grown?: boolean) => number
  /** Sets the work units that progress counts towards. */
  expect: (units: number) => void
  /**
   * Places the moving ones and `add` more (D45), confirmed on 10 cm cells.
   * With `previous`, the winner for one fewer, that plus one placed greedily
   * is a third start.
   */
  place: (add: number, previous?: readonly Point[]) => Confirmed
  stoppedEarly: () => boolean
}

type Confirmed = { at: Point[] } & PlacementScore

/**
 * What searches with different numbers added share: the scorers, the
 * lattice candidates and their signals, the clock and the progress count.
 */
function startSession(
  problem: PlacementProblem & {
    moving: readonly AccessPoint[]
  },
  options: SearchOptions & { refine?: boolean },
): Session | undefined {
  const { moving, band } = problem
  const coarse = createScorer(problem)
  if (!coarse) return undefined
  const candidates = candidatePositions(coarse)
  if (candidates.length === 0) return undefined
  const fine = createScorer({ ...problem, cellM: DEFAULT_CELL_M })!

  const now = options.now ?? (() => Date.now())
  const deadline = now() + (options.budgetMs ?? SEARCH_BUDGET_MS)
  let stoppedEarly = false
  const outOfTime = () => {
    if (!stoppedEarly && now() > deadline) stoppedEarly = true
    return stoppedEarly
  }

  // Each distinct kind of access point's signal from every candidate,
  // worked out once.
  const kindOf = (t: AccessPointTemplate) =>
    `${t.heightM}|${t.radios.find((r) => r.band === band)?.txPowerDbm}`
  const kinds = new Set([...moving, problem.template].map(kindOf))

  const refine = options.refine ?? true
  let total = 1
  let done = 0
  const progress = (units: number) => {
    done += units
    options.onProgress?.(Math.min(done / total, 1))
  }

  const lattice = new Map<string, Float32Array[]>()
  const latticeFor = (template: AccessPointTemplate) => {
    const kind = kindOf(template)
    let signals = lattice.get(kind)
    if (!signals) {
      signals = []
      for (const at of candidates) {
        if (outOfTime() && signals.length > 0) break
        signals.push(coarse.signal(at, template))
        progress(1)
      }
      lattice.set(kind, signals)
    }
    return signals
  }
  /** Adds an access point like `template` at the best lattice spot. */
  const placeGreedily = (layout: Layout, template: AccessPointTemplate) => {
    const signals = latticeFor(template)
    let best: (PlacementScore & { k: number }) | undefined
    for (let k = 0; k < signals.length; k++) {
      if (best && outOfTime()) break
      const score = coarse.score([...layout.signals, signals[k]!])
      if (!best || betterScore(score, best)) best = { ...score, k }
      progress(1)
    }
    layout.at.push(candidates[best!.k]!)
    layout.signals.push(signals[best!.k]!)
  }

  const counts = (add: number) => {
    const count = moving.length + add
    return {
      count,
      steps: refine ? ANNEAL_STEPS_PER_AP * count : 0,
      polishWork: refine ? count * REFINE_STEPS_M.length * 8 : 0,
    }
  }

  // Starts and counts share many spots, so 10 cm signals are kept too.
  const fineSignals = new Map<string, Float32Array>()
  const fineSignal = (at: Point, template: AccessPointTemplate) => {
    const key = `${at.x},${at.y}|${kindOf(template)}`
    let signal = fineSignals.get(key)
    if (!signal) {
      signal = fine.signal(at, template)
      fineSignals.set(key, signal)
    }
    return signal
  }

  const kept: Layout = {
    at: moving.map((ap) => ({ x: ap.x, y: ap.y })),
    signals: moving.map((ap) => coarse.signal(ap, ap)),
  }
  const fresh: Layout = { at: [], signals: [] }

  return {
    before: fine.score(moving.map((ap) => fine.signal(ap, ap))),
    latticeWork: candidates.length * kinds.size,
    // Rough work units: greedy checks, annealing steps, polishing.
    placeWork(add, grown = false) {
      const { steps, polishWork } = counts(add)
      const greedy = grown ? 3 : moving.length + 2 * add
      return candidates.length * greedy + steps + polishWork
    },
    expect(units) {
      total = Math.max(units, 1)
    },
    stoppedEarly: () => stoppedEarly,
    place(add, previous) {
      const { count, steps, polishWork } = counts(add)
      const templates: AccessPointTemplate[] = [
        ...moving,
        ...Array.from({ length: add }, () => problem.template),
      ]
      // Two starts: the moving ones where they are with the added ones
      // placed greedily, and every one placed greedily in turn. Greedy
      // placements only depend on the ones before, so they're kept between
      // counts and extended.
      for (let i = kept.at.length; i < count; i++) {
        placeGreedily(kept, templates[i]!)
      }
      for (let i = fresh.at.length; i < count; i++) {
        placeGreedily(fresh, templates[i]!)
      }
      const first = (layout: Layout): Layout => ({
        at: layout.at.slice(0, count),
        signals: layout.signals.slice(0, count),
      })
      const starts = [first(kept), first(fresh)]
      if (previous) {
        const grown: Layout = {
          at: [...previous],
          signals: previous.map((p, i) => coarse.signal(p, templates[i])),
        }
        placeGreedily(grown, problem.template)
        starts.push(grown)
      }
      const start = starts.reduce((a, b) =>
        betterScore(coarse.score(b.signals), coarse.score(a.signals)) ? b : a,
      )

      // Refine all of them together, then polish each in turn.
      let best = anneal(coarse, start, templates, candidates, steps, {
        outOfTime,
        progress,
      })
      if (refine) best = polish(coarse, best, templates, outOfTime)
      progress(polishWork)

      // Confirm on 10 cm cells: refining wins only if it beats every start,
      // so it never lowers the score.
      const fineScore = (at: Point[]): Confirmed => ({
        at,
        ...fine.score(at.map((p, i) => fineSignal(p, templates[i]!))),
      })
      return starts
        .map((s) => fineScore(s.at))
        .reduce((a, b) => (betterScore(b, a) ? b : a), fineScore(best.at))
    },
  }
}

interface Layout {
  at: Point[]
  signals: Float32Array[]
}

type Scored = Layout & PlacementScore

/**
 * Simulated annealing over all positions (D45). Each step moves one access
 * point, in turn: usually a random step whose length shrinks from 2 m to
 * 10 cm, sometimes a jump to a random lattice candidate to reach another
 * room. The energy counts covered cells, with the weakest spot as a small
 * tie-break (70 dB of it is worth less than one cell), and a worse layout is
 * accepted with probability exp(ΔE / T), T cooling geometrically from 1% of
 * the cells to 0.05 of a cell. The best layout seen is returned.
 */
function anneal(
  scorer: Scorer,
  start: Layout,
  templates: readonly AccessPointTemplate[],
  candidates: readonly Point[],
  steps: number,
  {
    outOfTime,
    progress,
  }: { outOfTime: () => boolean; progress: (units: number) => void },
): Scored {
  const random = mulberry32(ANNEAL_SEED)
  const energy = (s: PlacementScore) =>
    s.share * scorer.cellCount + 0.01 * s.weakestDbm

  let current: Scored = { ...start, ...scorer.score(start.signals) }
  let best = current
  const tStart = 0.01 * scorer.cellCount
  const tEnd = 0.05
  const finest = REFINE_STEPS_M.at(-1)!

  for (let step = 0; step < steps; step++) {
    if (outOfTime()) break
    progress(1)
    const t = step / Math.max(steps - 1, 1)
    const temperature = tStart * (tEnd / tStart) ** t
    const reach = ANNEAL_START_STEP_M * (finest / ANNEAL_START_STEP_M) ** t
    const i = step % current.at.length

    let to: Point
    if (random() < JUMP_CHANCE && candidates.length > 0) {
      to = candidates[Math.floor(random() * candidates.length)]!
    } else {
      const angle = random() * 2 * Math.PI
      const length = reach * (0.5 + random())
      const from = current.at[i]!
      to = {
        x: round(from.x + length * Math.cos(angle)),
        y: round(from.y + length * Math.sin(angle)),
      }
    }
    // Draw the acceptance number every step, so the sequence doesn't depend
    // on which proposals were allowed.
    const chance = random()
    if (!scorer.allows(to)) continue

    const signals = [...current.signals]
    signals[i] = scorer.signal(to, templates[i])
    const score = scorer.score(signals)
    const delta = energy(score) - energy(current)
    if (delta >= 0 || chance < Math.exp(delta / temperature)) {
      const at = [...current.at]
      at[i] = to
      current = { at, signals, ...score }
      if (betterScore(current, best)) best = current
    }
  }
  return best
}

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
 * Pattern search on each access point in turn (D42's refining, one at a
 * time): at each step size, move to the best of its 8 neighbours while that
 * improves the score, until no access point moves.
 */
function polish(
  scorer: Scorer,
  start: Scored,
  templates: readonly AccessPointTemplate[],
  outOfTime: () => boolean,
): Scored {
  let best = start
  for (const step of REFINE_STEPS_M) {
    for (let moved = true; moved;) {
      moved = false
      for (let i = 0; i < best.at.length; i++) {
        for (;;) {
          let next = best
          for (const [dx, dy] of DIRECTIONS) {
            if (outOfTime()) return best
            const to = {
              x: round(best.at[i]!.x + dx * step),
              y: round(best.at[i]!.y + dy * step),
            }
            if (!scorer.allows(to)) continue
            const signals = [...best.signals]
            signals[i] = scorer.signal(to, templates[i])
            const score = scorer.score(signals)
            if (betterScore(score, next)) {
              const at = [...best.at]
              at[i] = to
              next = { at, signals, ...score }
            }
          }
          if (next === best) break
          best = next
          moved = true
        }
      }
    }
  }
  return best
}

/** A small, fast seeded random number generator, giving [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rounds to 0.1 mm so repeated steps don't drift. */
function round(value: number): number {
  return Math.round(value * 1e4) / 1e4
}
