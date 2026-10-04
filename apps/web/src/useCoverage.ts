import type {
  Coverage,
  EngineRequest,
  EngineResponse,
} from '@signalplan/engine'
import type { Band, Plan } from '@signalplan/floorplan'
import { useCallback, useEffect, useRef, useState } from 'react'
import { workerFailureText } from './workerFailure.ts'

type Job = Omit<EngineRequest, 'id'>

/**
 * Computes coverage in a Web Worker. While one job runs, only the newest
 * request waits behind it, so dragging never builds a backlog. A result for
 * another floor than the one on show is held back, so switching floors never
 * shows one floor's heatmap under another's walls (D52). If the worker fails,
 * `error` says why until the next result, and `retry` starts a fresh worker
 * (D91).
 */
export function useCoverage(plan: Plan, floorId: string, band: Band) {
  const [result, setResult] = useState<{
    coverage: Coverage
    floorId: string
  }>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const submit = useRef<(job: Job) => void>(undefined)

  useEffect(() => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch (failure) {
      queueMicrotask(() => setError(workerFailureText(failure)))
      return
    }
    let busy = false
    let pending: Job | undefined
    let nextId = 0
    const floorOf = new Map<number, string>()

    const send = (job: Job) => {
      busy = true
      floorOf.set(nextId, job.floorId)
      worker.postMessage({ ...job, id: nextId++ } satisfies EngineRequest)
    }
    const next = () => {
      busy = false
      const job = pending
      pending = undefined
      if (job) send(job)
    }
    worker.addEventListener(
      'message',
      (event: MessageEvent<EngineResponse>) => {
        const response = event.data
        const jobFloor = floorOf.get(response.id)!
        floorOf.delete(response.id)
        if (response.kind === 'coverage') {
          setResult({ coverage: response.coverage, floorId: jobFloor })
          setError(undefined)
        } else {
          setError(response.message)
        }
        next()
      },
    )
    // The worker threw, or a message couldn't be read: the job it was on
    // will never answer. A newer job waiting behind it still gets its go.
    const failed = (failure: unknown) => {
      setError(workerFailureText(failure))
      floorOf.clear()
      next()
    }
    worker.addEventListener('error', failed)
    worker.addEventListener('messageerror', failed)
    submit.current = (job) => {
      if (busy) pending = job
      else send(job)
    }
    return () => {
      worker.terminate()
      submit.current = undefined
    }
  }, [attempt])

  useEffect(() => {
    submit.current?.({ kind: 'coverage', plan, floorId, band })
  }, [plan, floorId, band, attempt])

  const retry = useCallback(() => {
    setError(undefined)
    setAttempt((n) => n + 1)
  }, [])

  const coverage =
    !error && result?.floorId === floorId ? result.coverage : undefined
  return { coverage, error, retry }
}
