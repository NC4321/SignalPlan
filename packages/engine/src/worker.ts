import type { Band, Plan } from '@signalplan/floorplan'
import { evaluateCoverage, type Coverage } from './coverage.ts'
import {
  searchHowMany,
  searchMultiPlacement,
  type HowManyProblem,
  type HowManyResult,
  type MultiPlacementProblem,
  type MultiSearchResult,
} from './multiSearch.ts'
import {
  searchSinglePlacement,
  type SearchResult,
  type SinglePlacementProblem,
} from './search.ts'

/**
 * Messages between the page and the engine's Web Worker. The worker entry
 * point lives in the web app; it passes each request to `handleRequest` and
 * posts the response back with `transferables` so grids aren't copied.
 */
export type EngineRequest = {
  id: number
  kind: 'coverage'
  plan: Plan
  floorId: string
  band: Band
  cellM?: number
}

export type EngineResponse =
  | { id: number; kind: 'coverage'; coverage: Coverage }
  | { id: number; kind: 'error'; message: string }

export function handleRequest(request: EngineRequest): EngineResponse {
  try {
    const coverage = evaluateCoverage(
      request.plan,
      request.floorId,
      request.band,
      request.cellM,
    )
    return { id: request.id, kind: 'coverage', coverage }
  } catch (error) {
    return {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Buffers in a response that can be transferred instead of copied. */
export function transferables(response: EngineResponse): ArrayBuffer[] {
  if (response.kind !== 'coverage') return []
  return [
    response.coverage.dbm.buffer as ArrayBuffer,
    response.coverage.strongest.buffer as ArrayBuffer,
    response.coverage.floorArea.buffer as ArrayBuffer,
    response.coverage.sourceDbm.buffer as ArrayBuffer,
  ]
}

/**
 * The placement optimizer runs in its own worker, so the heatmap keeps
 * updating meanwhile. Cancelling terminates that worker (D42).
 */
export type PlacementRequest =
  | { id: number; kind: 'place-one'; problem: SinglePlacementProblem }
  | { id: number; kind: 'place-many'; problem: MultiPlacementProblem }
  | { id: number; kind: 'how-many'; problem: HowManyProblem }

export type PlacementMessage =
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'result'; result: SearchResult }
  | { id: number; kind: 'result-many'; result: MultiSearchResult }
  | { id: number; kind: 'result-how-many'; result: HowManyResult }
  | { id: number; kind: 'error'; message: string }

/** Progress is posted at most this often, in milliseconds. */
const PROGRESS_INTERVAL_MS = 100

export function handlePlacementRequest(
  request: PlacementRequest,
  post: (message: PlacementMessage) => void,
  now: () => number = () => Date.now(),
): void {
  const { id } = request
  try {
    let last = Number.NEGATIVE_INFINITY
    const options = {
      now,
      onProgress: (fraction: number) => {
        const t = now()
        if (fraction < 1 && t - last < PROGRESS_INTERVAL_MS) return
        last = t
        post({ id, kind: 'progress', fraction })
      },
    }
    if (request.kind === 'how-many') {
      const result = searchHowMany(request.problem, options)
      post({ id, kind: 'result-how-many', result })
    } else if (request.kind === 'place-many') {
      const result = searchMultiPlacement(request.problem, options)
      post({ id, kind: 'result-many', result })
    } else {
      const result = searchSinglePlacement(request.problem, options)
      post({ id, kind: 'result', result })
    }
  } catch (error) {
    post({
      id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
