import type {
  Coverage,
  EngineRequest,
  EngineResponse,
} from '@signalplan/engine'
import type { Band, Plan } from '@signalplan/floorplan'
import { useCallback, useEffect, useRef, useState } from 'react'
import { failure, type Failure } from './workerFailure.ts'

/**
 * Coverage of every floor, for the 3D view (D57), worked out one floor at a
 * time in its own worker while `enabled`. When the plan or band changes,
 * the floors still to do are replaced by those of the new plan; results
 * already shown stay until their floor is redone, and floors that no longer
 * exist are dropped. If the worker fails, `error` says why until a floor
 * works out again, and `retry` starts a fresh worker (D91).
 */
export function useFloorsCoverage(
  plan: Plan,
  band: Band,
  enabled: boolean,
): {
  coverages: ReadonlyMap<string, Coverage>
  error: Failure | undefined
  retry: () => void
} {
  const [coverages, setCoverages] = useState<ReadonlyMap<string, Coverage>>(
    () => new Map(),
  )
  const [error, setError] = useState<Failure>()
  const [attempt, setAttempt] = useState(0)
  const queue = useRef<(job: { plan: Plan; band: Band }) => void>(undefined)

  useEffect(() => {
    if (!enabled) return
    let worker: Worker
    try {
      worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch (thrown) {
      const failed = failure('worker', thrown)
      queueMicrotask(() => setError(failed))
      return
    }
    let todo: Omit<EngineRequest, 'id'>[] = []
    let busy = false
    let nextId = 0
    // Which floor each request is for.
    const floorOf = new Map<number, string>()
    const sendNext = () => {
      const job = todo.shift()
      busy = job !== undefined
      if (!job) return
      const id = nextId++
      floorOf.set(id, job.floorId)
      worker.postMessage({ ...job, id } satisfies EngineRequest)
    }
    worker.addEventListener(
      'message',
      (event: MessageEvent<EngineResponse>) => {
        const response = event.data
        if (response.kind === 'error')
          setError(failure('plan', response.message))
        if (response.kind === 'coverage') {
          setError(undefined)
          const { coverage } = response
          const floorId = floorOf.get(response.id)
          if (floorId !== undefined) {
            setCoverages((old) => new Map(old).set(floorId, coverage))
          }
        }
        floorOf.delete(response.id)
        sendNext()
      },
    )
    // The worker threw, or a message couldn't be read: the floor it was on
    // won't answer, so the rest of the queue carries on.
    const failed = (event: unknown) => {
      setError(failure('worker', event))
      floorOf.clear()
      sendNext()
    }
    worker.addEventListener('error', failed)
    worker.addEventListener('messageerror', failed)
    queue.current = ({ plan, band }) => {
      const ids = new Set(plan.floors.map((f) => f.id))
      setCoverages((old) =>
        [...old.keys()].every((id) => ids.has(id))
          ? old
          : new Map([...old].filter(([id]) => ids.has(id))),
      )
      todo = plan.floors.map((floor) => ({
        kind: 'coverage' as const,
        plan,
        floorId: floor.id,
        band,
      }))
      if (!busy) sendNext()
    }
    return () => {
      worker.terminate()
      queue.current = undefined
      // A failure belongs to the worker that had it: not to the next one, nor
      // to the 3D view the next time it's opened.
      setError(undefined)
    }
  }, [enabled, attempt])

  useEffect(() => {
    if (enabled) queue.current?.({ plan, band })
  }, [plan, band, enabled, attempt])

  const retry = useCallback(() => {
    setError(undefined)
    setAttempt((n) => n + 1)
  }, [])

  return { coverages, error: enabled ? error : undefined, retry }
}
