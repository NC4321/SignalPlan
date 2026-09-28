import type { Band, Plan } from '@signalplan/floorplan'
import { evaluateCoverage, type Coverage } from './coverage.ts'

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
  ]
}
