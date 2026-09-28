import type {
  Coverage,
  EngineRequest,
  EngineResponse,
} from '@signalplan/engine'
import type { Band, Plan } from '@signalplan/floorplan'
import { useEffect, useRef, useState } from 'react'

type Job = Omit<EngineRequest, 'id'>

/**
 * Computes coverage in a Web Worker. While one job runs, only the newest
 * request waits behind it, so dragging never builds a backlog. A result for
 * another floor than the one on show is held back, so switching floors never
 * shows one floor's heatmap under another's walls (D52).
 */
export function useCoverage(plan: Plan, floorId: string, band: Band) {
  const [result, setResult] = useState<{
    coverage: Coverage
    floorId: string
  }>()
  const [error, setError] = useState<string>()
  const submit = useRef<(job: Job) => void>(undefined)

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    let busy = false
    let pending: Job | undefined
    let nextId = 0
    const floorOf = new Map<number, string>()

    const send = (job: Job) => {
      busy = true
      floorOf.set(nextId, job.floorId)
      worker.postMessage({ ...job, id: nextId++ } satisfies EngineRequest)
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
        busy = false
        const next = pending
        pending = undefined
        if (next) send(next)
      },
    )
    submit.current = (job) => {
      if (busy) pending = job
      else send(job)
    }
    return () => {
      worker.terminate()
      submit.current = undefined
    }
  }, [])

  useEffect(() => {
    submit.current?.({ kind: 'coverage', plan, floorId, band })
  }, [plan, floorId, band])

  const coverage = result?.floorId === floorId ? result.coverage : undefined
  return { coverage, error }
}
