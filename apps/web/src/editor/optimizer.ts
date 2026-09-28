import type {
  AccessPointTemplate,
  PlacementMessage,
  PlacementRequest,
} from '@signalplan/engine'
import {
  addAccessPoint,
  BANDS,
  NEW_ACCESS_POINT_HEIGHT_M,
  type AccessPoint,
  type Band,
  type CoverageTarget,
  type Plan,
  type Point,
} from '@signalplan/floorplan'
import { produce, type Draft } from 'immer'
import type { StoreApi } from 'zustand/vanilla'
import { targetBand } from '../quality.ts'
import { BAND_LABELS } from './coverageText.ts'
import type { EditorState, Selection } from './store.ts'
import { formatLength, type Units } from './units.ts'

/**
 * The optimizer panel (D44, D45): which access points a search moves or
 * adds, the search in its own worker, and the suggestion it leaves for Apply
 * or Dismiss.
 */

/** An access point a search places: one that moves, or a new one. */
export interface Mover {
  /** Undefined for a new access point. */
  apId: string | undefined
  /** Its name, or the name a new one will get. */
  name: string
  /** Where it is now; undefined for a new one. */
  from: Point | undefined
  /** Its height and radios; a new one gets a copy. */
  template: AccessPointTemplate
}

export type SuggestedMove = Mover & { to: Point }

/** Suggested spots, waiting for Apply or Dismiss. */
export interface Suggestion {
  moves: SuggestedMove[]
  floorId: string
  band: Band
  /** Shares of the floor at the target, before and after, on 10 cm cells. */
  before: number
  after: number
  /** The weakest signal inside the walls before (when nothing is added) and after. */
  beforeWeakestDbm: number | undefined
  weakestDbm: number
  /** True if the 10 s budget ran out and this is the best found so far. */
  stoppedEarly: boolean
}

export type OptimizerState =
  | { status: 'searching'; fraction: number; what: string }
  | { status: 'suggestion'; suggestion: Suggestion }
  | { status: 'message'; text: string }

/**
 * "best" finds better spots for what can move (or places the first access
 * point); "one-more" adds an access point and moves the rest to suit (D45).
 */
export type SearchKind = 'best' | 'one-more'

export type SearchJob =
  | {
      kind: 'ready'
      /** The button's label. */
      label: string
      /** What it searches for, after "Searching for". */
      what: string
      request: WithoutId<PlacementRequest>
      movers: Mover[]
    }
  | { kind: 'unavailable'; reason: string }

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

/** A new access point's settings when there's nothing to copy (D25). */
const DEFAULT_TEMPLATE: AccessPointTemplate = {
  heightM: NEW_ACCESS_POINT_HEIGHT_M,
  radios: BANDS.map((band) => ({ band })),
}

const templateOf = (ap: AccessPoint): AccessPointTemplate => ({
  heightM: ap.heightM,
  radios: ap.radios,
})

const broadcasts = (ap: AccessPoint, band: Band) =>
  ap.radios.some((r) => r.band === band)

/**
 * What a search does (D44, D45). "best": the selected access point moves;
 * with nothing selected, every unlocked one that broadcasts on the band moves
 * (together, if there are several); on an empty floor, one is added.
 * "one-more", only with nothing selected on a floor that has access points:
 * one is added, a copy of the first that broadcasts on the band, and the
 * unlocked ones move to suit. Everything else on the floor stays.
 */
export function planSearch(
  plan: Plan,
  floorId: string,
  band: Band,
  selection: Selection,
  kind: SearchKind = 'best',
): SearchJob | undefined {
  const onFloor = plan.accessPoints.filter((ap) => ap.floorId === floorId)
  const unlocked = onFloor.filter((ap) => !ap.locked)
  const movable = unlocked.filter((ap) => broadcasts(ap, band))
  const base = {
    plan,
    floorId,
    band,
    minDbm: targetBand(plan.coverageTarget).minDbm,
  }
  const fixedWithout = (moving: readonly AccessPoint[]) =>
    onFloor.filter((ap) => !moving.includes(ap))
  const moverOf = (ap: AccessPoint): Mover => ({
    apId: ap.id,
    name: ap.name,
    from: { x: ap.x, y: ap.y },
    template: templateOf(ap),
  })
  const moveOne = (ap: AccessPoint): SearchJob => ({
    kind: 'ready',
    label: `Find a better spot for ${ap.name}`,
    what: `a spot for ${ap.name}`,
    request: {
      kind: 'place-one',
      problem: {
        ...base,
        fixed: fixedWithout([ap]),
        template: templateOf(ap),
        current: { x: ap.x, y: ap.y },
      },
    },
    movers: [moverOf(ap)],
  })

  if (kind === 'one-more') {
    if (selection.length > 0 || onFloor.length === 0) return undefined
    const model = onFloor.find((ap) => broadcasts(ap, band))
    const template = model ? templateOf(model) : DEFAULT_TEMPLATE
    return {
      kind: 'ready',
      label: 'Suggest one more access point',
      what: 'a spot for one more access point',
      request: {
        kind: 'place-many',
        problem: {
          ...base,
          fixed: fixedWithout(movable),
          moving: movable,
          add: 1,
          template,
        },
      },
      movers: [
        ...movable.map(moverOf),
        {
          apId: undefined,
          name: newNames(plan, 1)[0]!,
          from: undefined,
          template,
        },
      ],
    }
  }

  if (selection.length > 0) {
    const only = selection.length === 1 ? selection[0] : undefined
    const ap =
      only?.kind === 'accessPoint'
        ? onFloor.find((a) => a.id === only.id)
        : undefined
    if (!ap) {
      return {
        kind: 'unavailable',
        reason: 'Select one access point to find it a better spot.',
      }
    }
    if (ap.locked) {
      return {
        kind: 'unavailable',
        reason: `${ap.name} is locked. Untick Locked to let it move.`,
      }
    }
    if (!broadcasts(ap, band)) return bandOff(ap.name, band)
    return moveOne(ap)
  }

  if (onFloor.length === 0) {
    return {
      kind: 'ready',
      label: 'Find the best spot for an access point',
      what: 'a spot for an access point',
      request: {
        kind: 'place-one',
        problem: { ...base, fixed: [], template: DEFAULT_TEMPLATE },
      },
      movers: [
        {
          apId: undefined,
          name: newNames(plan, 1)[0]!,
          from: undefined,
          template: DEFAULT_TEMPLATE,
        },
      ],
    }
  }
  if (unlocked.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'Every access point is locked. Unlock one to let it move.',
    }
  }
  if (movable.length === 0) {
    return unlocked.length === 1
      ? bandOff(unlocked[0]!.name, band)
      : {
          kind: 'unavailable',
          reason: `No unlocked access point broadcasts on ${BAND_LABELS[band]}. Turn the band on under Bands first.`,
        }
  }
  if (movable.length === 1) return moveOne(movable[0]!)
  return {
    kind: 'ready',
    label: `Find better spots for ${movable.length} access points`,
    what: `spots for ${movable.length} access points`,
    request: {
      kind: 'place-many',
      problem: {
        ...base,
        fixed: fixedWithout(movable),
        moving: movable,
        add: 0,
        template: templateOf(movable[0]!),
      },
    },
    movers: movable.map(moverOf),
  }
}

const bandOff = (name: string, band: Band): SearchJob => ({
  kind: 'unavailable',
  reason: `${name} doesn’t broadcast on ${BAND_LABELS[band]}. Turn the band on under Bands first.`,
})

/** The names the next `count` new access points will get, in order. */
export function newNames(plan: Plan, count: number): string[] {
  let names: string[] = []
  produce(plan, (draft) => {
    const before = draft.accessPoints.length
    for (let i = 0; i < count; i++) addAccessPoint(draft, '', { x: 0, y: 0 })
    names = draft.accessPoints.slice(before).map((ap) => ap.name)
  })
  return names
}

/** Moves and adds the access points, as one edit. */
export function suggestionRecipe(suggestion: Suggestion) {
  return (plan: Draft<Plan>) => {
    for (const move of suggestion.moves) {
      if (move.apId === undefined) {
        const id = addAccessPoint(plan, suggestion.floorId, move.to)
        const added = plan.accessPoints.find((a) => a.id === id)!
        added.heightM = move.template.heightM
        added.radios = move.template.radios.map((radio) => ({ ...radio }))
        continue
      }
      const ap = plan.accessPoints.find((a) => a.id === move.apId)
      if (!ap) continue
      ap.x = move.to.x
      ap.y = move.to.y
    }
  }
}

/** The plan as it would be after Apply, for the heatmap's preview. */
export function withSuggestion(plan: Plan, suggestion: Suggestion): Plan {
  return produce(plan, suggestionRecipe(suggestion))
}

/** Closer than this to where it is, an access point is already in place. */
export const SAME_SPOT_M = 0.1

/** Turns the worker's answer into what the panel shows. */
export function searchOutcome(
  message: Exclude<PlacementMessage, { kind: 'progress' }>,
  job: Extract<SearchJob, { kind: 'ready' }>,
): OptimizerState {
  if (message.kind === 'error') {
    return { status: 'message', text: `Couldn’t search: ${message.message}` }
  }
  const { band, floorId } = job.request.problem
  const result = message.result
  switch (result.kind) {
    case 'no-floor-area':
      return {
        status: 'message',
        text: 'Close the outer walls first: suggested spots go inside them.',
      }
    case 'no-radio':
      return {
        status: 'message',
        text: `A new access point wouldn’t broadcast on ${BAND_LABELS[band]}.`,
      }
    case 'nothing-to-place':
      return { status: 'message', text: 'There’s nothing to move or add.' }
    case 'found': {
      const positions =
        'positions' in result ? result.positions : [result.position]
      const moves = job.movers.map((mover, i) => ({
        ...mover,
        to: positions[i]!,
      }))
      const inPlace = moves.every(
        ({ from, to }) =>
          from && Math.hypot(to.x - from.x, to.y - from.y) < SAME_SPOT_M,
      )
      if (inPlace) {
        return {
          status: 'message',
          text:
            moves.length === 1
              ? `${moves[0]!.name} is already in the best spot found.`
              : 'The access points are already in the best spots found.',
        }
      }
      const adds = moves.some((m) => m.apId === undefined)
      return {
        status: 'suggestion',
        suggestion: {
          moves,
          floorId,
          band,
          // With nothing else on the floor, nothing is covered before.
          before: result.before ?? 0,
          after: result.share,
          beforeWeakestDbm: adds ? undefined : result.beforeWeakestDbm,
          weakestDbm: result.weakestDbm,
          stoppedEarly: result.stoppedEarly,
        },
      }
    }
  }
}

const percent = (share: number) => `${Math.floor(share * 100)}%`

/**
 * The before → after line, rounded down like the coverage summary (D27),
 * e.g. "72% → 91% of the floor at Fair or better on 5 GHz."
 */
export function suggestionText(
  suggestion: Suggestion,
  target: CoverageTarget | undefined,
): string {
  const goal = targetBand(target)
  const { before, after, beforeWeakestDbm, weakestDbm } = suggestion
  const line = `${percent(before)} → ${percent(after)} of the floor at ${goal.label} or better on ${BAND_LABELS[suggestion.band]}.`
  if (percent(before) !== percent(after) || beforeWeakestDbm === undefined) {
    return line
  }
  return `${line} The weakest spot improves from ${beforeWeakestDbm.toFixed(0)} to ${weakestDbm.toFixed(0)} dBm.`
}

/**
 * The whole suggestion in words, e.g. "Move Router to 1.00 m, 2.00 m and
 * add Access point 2 at 6.00 m, 2.00 m: 50% → 100% of the floor at …".
 */
export function suggestionSummary(
  suggestion: Suggestion,
  target: CoverageTarget | undefined,
  units: Units,
): string {
  const clauses = suggestion.moves.map(({ apId, name, to }) => {
    const at = `${formatLength(to.x, units)}, ${formatLength(to.y, units)}`
    return apId === undefined ? `add ${name} at ${at}` : `move ${name} to ${at}`
  })
  const last = clauses.pop()!
  const list = clauses.length > 0 ? `${clauses.join(', ')} and ${last}` : last
  const early = suggestion.stoppedEarly
    ? ' The search hit its 10 second limit, so this is the best found so far.'
    : ''
  return `${list[0]!.toUpperCase()}${list.slice(1)}: ${suggestionText(suggestion, target)}${early}`
}

/** The parts of a Worker the optimizer uses, so tests can fake it. */
export interface SearchWorker {
  postMessage(request: PlacementRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<PlacementMessage>) => void) | null
}

export interface Optimizer {
  /** Starts the search `planSearch` plans for this kind. */
  start: (kind?: SearchKind) => void
  /** Stops a search, or dismisses its result. */
  cancel: () => void
}

/**
 * Runs searches in a fresh worker each time. The store holds the state, and
 * whenever it stops being "searching" (Cancel, or an edit making the search
 * stale), the worker is terminated. Nothing runs until `start`, so creating
 * one has no side effects.
 */
export function createOptimizer(
  store: StoreApi<EditorState>,
  makeWorker: () => SearchWorker,
): Optimizer & { dispose: () => void } {
  let worker: SearchWorker | undefined
  let unsubscribe: (() => void) | undefined
  let nextId = 0
  const stop = () => {
    worker?.terminate()
    worker = undefined
    unsubscribe?.()
    unsubscribe = undefined
  }

  return {
    start(kind = 'best') {
      stop()
      const { plan, floorId, band, selection, setOptimizer } = store.getState()
      const job = planSearch(plan, floorId, band, selection, kind)
      if (!job) return
      if (job.kind === 'unavailable') {
        setOptimizer({ status: 'message', text: job.reason })
        return
      }
      const { what } = job
      const id = nextId++
      const w = makeWorker()
      worker = w
      w.onmessage = ({ data }) => {
        if (worker !== w || data.id !== id) return
        if (data.kind === 'progress') {
          store.getState().setOptimizer({
            status: 'searching',
            fraction: data.fraction,
            what,
          })
          return
        }
        stop()
        store.getState().setOptimizer(searchOutcome(data, job))
      }
      setOptimizer({ status: 'searching', fraction: 0, what })
      unsubscribe = store.subscribe((state) => {
        if (state.optimizer?.status !== 'searching') stop()
      })
      w.postMessage({ ...job.request, id } as PlacementRequest)
    },
    cancel() {
      store.getState().setOptimizer(undefined)
    },
    dispose: stop,
  }
}
