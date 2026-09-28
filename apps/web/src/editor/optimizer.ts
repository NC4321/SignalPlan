import type {
  PlacementMessage,
  PlacementRequest,
  SinglePlacementProblem,
} from '@signalplan/engine'
import {
  addAccessPoint,
  BANDS,
  nextAccessPointName,
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

/**
 * The optimizer panel (D44): which access point a search moves, the search
 * in its own worker, and the suggestion it leaves for Apply or Dismiss.
 */

/** A suggested spot, waiting for Apply or Dismiss. */
export interface Suggestion {
  /** The access point that moves, or undefined when one is added. */
  apId: string | undefined
  /** Its name, or the name a new one will get. */
  name: string
  floorId: string
  band: Band
  /** Where it is now; undefined when one is added. */
  from: Point | undefined
  position: Point
  /** Shares of the floor at the target, before and after, on 10 cm cells. */
  before: number
  after: number
  /** The weakest signal inside the walls before (if it moves) and after. */
  beforeWeakestDbm: number | undefined
  weakestDbm: number
  /** True if the 10 s budget ran out and this is the best found so far. */
  stoppedEarly: boolean
}

export type OptimizerState =
  | { status: 'searching'; fraction: number; name: string }
  | { status: 'suggestion'; suggestion: Suggestion }
  | { status: 'message'; text: string }

export type OptimizerTarget =
  | { kind: 'move'; ap: AccessPoint }
  | { kind: 'add' }
  | { kind: 'unavailable'; reason: string }

/**
 * Which access point a search moves (D44): the selected one; with nothing
 * selected, the only unlocked one on the floor; with none on the floor, a new
 * one. Everything else stays where it is. Several unlocked access points and
 * no selection need a choice, until the multi-AP search (#73).
 */
export function chooseTarget(
  plan: Plan,
  floorId: string,
  band: Band,
  selection: Selection,
): OptimizerTarget {
  const onFloor = plan.accessPoints.filter((ap) => ap.floorId === floorId)
  let ap: AccessPoint | undefined
  if (selection.length > 0) {
    const only = selection.length === 1 ? selection[0] : undefined
    ap =
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
  } else {
    if (onFloor.length === 0) return { kind: 'add' }
    const unlocked = onFloor.filter((a) => !a.locked)
    if (unlocked.length === 0) {
      return {
        kind: 'unavailable',
        reason: 'Every access point is locked. Unlock one to let it move.',
      }
    }
    if (unlocked.length > 1) {
      return {
        kind: 'unavailable',
        reason:
          'Select the access point to move; the others stay where they are.',
      }
    }
    ap = unlocked[0]!
  }
  if (!ap.radios.some((r) => r.band === band)) {
    return {
      kind: 'unavailable',
      reason: `${ap.name} doesn’t broadcast on ${BAND_LABELS[band]}. Turn the band on under Bands first.`,
    }
  }
  return { kind: 'move', ap }
}

/** The search for a target: it moves, everything else on the floor stays. */
export function placementProblem(
  plan: Plan,
  floorId: string,
  band: Band,
  target: Exclude<OptimizerTarget, { kind: 'unavailable' }>,
): SinglePlacementProblem {
  const moving = target.kind === 'move' ? target.ap : undefined
  const problem: SinglePlacementProblem = {
    plan,
    floorId,
    band,
    minDbm: targetBand(plan.coverageTarget).minDbm,
    fixed: plan.accessPoints.filter(
      (ap) => ap.floorId === floorId && ap.id !== moving?.id,
    ),
    // A new access point is like one the Access point tool adds.
    template: moving
      ? { heightM: moving.heightM, radios: moving.radios }
      : {
          heightM: NEW_ACCESS_POINT_HEIGHT_M,
          radios: BANDS.map((b) => ({ band: b })),
        },
  }
  if (moving) problem.current = { x: moving.x, y: moving.y }
  return problem
}

/** Moves or adds the access point, as one edit. */
export function suggestionRecipe(suggestion: Suggestion) {
  return (plan: Draft<Plan>) => {
    const { apId, position } = suggestion
    if (apId === undefined) {
      addAccessPoint(plan, suggestion.floorId, position)
      return
    }
    const ap = plan.accessPoints.find((a) => a.id === apId)
    if (!ap) return
    ap.x = position.x
    ap.y = position.y
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
  context: {
    name: string
    apId: string | undefined
    problem: SinglePlacementProblem
  },
): OptimizerState {
  if (message.kind === 'error') {
    return { status: 'message', text: `Couldn’t search: ${message.message}` }
  }
  const { result } = message
  const { problem, name, apId } = context
  switch (result.kind) {
    case 'no-floor-area':
      return {
        status: 'message',
        text: 'Close the outer walls first: suggested spots go inside them.',
      }
    case 'no-radio':
      return {
        status: 'message',
        text: `${name} doesn’t broadcast on ${BAND_LABELS[problem.band]}.`,
      }
    case 'found': {
      const from = problem.current
      if (
        from &&
        Math.hypot(result.position.x - from.x, result.position.y - from.y) <
          SAME_SPOT_M
      ) {
        return {
          status: 'message',
          text: `${name} is already in the best spot found.`,
        }
      }
      return {
        status: 'suggestion',
        suggestion: {
          apId,
          name,
          floorId: problem.floorId,
          band: problem.band,
          from,
          position: result.position,
          // With nothing else on the floor, nothing is covered before.
          before: result.before ?? 0,
          after: result.share,
          beforeWeakestDbm: result.beforeWeakestDbm,
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

/** The parts of a Worker the optimizer uses, so tests can fake it. */
export interface SearchWorker {
  postMessage(request: PlacementRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<PlacementMessage>) => void) | null
}

export interface Optimizer {
  /** Starts a search for the target `chooseTarget` picks. */
  start: () => void
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
    start() {
      stop()
      const { plan, floorId, band, selection, setOptimizer } = store.getState()
      const target = chooseTarget(plan, floorId, band, selection)
      if (target.kind === 'unavailable') {
        setOptimizer({ status: 'message', text: target.reason })
        return
      }
      const problem = placementProblem(plan, floorId, band, target)
      const apId = target.kind === 'move' ? target.ap.id : undefined
      const name =
        target.kind === 'move' ? target.ap.name : nextAccessPointName(plan)
      const id = nextId++
      const w = makeWorker()
      worker = w
      w.onmessage = ({ data }) => {
        if (worker !== w || data.id !== id) return
        if (data.kind === 'progress') {
          store.getState().setOptimizer({
            status: 'searching',
            fraction: data.fraction,
            name,
          })
          return
        }
        stop()
        store
          .getState()
          .setOptimizer(searchOutcome(data, { name, apId, problem }))
      }
      setOptimizer({ status: 'searching', fraction: 0, name })
      unsubscribe = store.subscribe((state) => {
        if (state.optimizer?.status !== 'searching') stop()
      })
      w.postMessage({ id, kind: 'place-one', problem })
    },
    cancel() {
      store.getState().setOptimizer(undefined)
    },
    dispose: stop,
  }
}
