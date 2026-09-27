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
 * request waits behind it, so dragging never builds a backlog.
 */
export function useCoverage(plan: Plan, floorId: string, band: Band) {
  const [coverage, setCoverage] = useState<Coverage>()
  const [error, setError] = useState<string>()
  const submit = useRef<(job: Job) => void>(undefined)

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    let busy = false
    let pending: Job | undefined
    let nextId = 0

    const send = (job: Job) => {
      busy = true
      worker.postMessage({ ...job, id: nextId++ } satisfies EngineRequest)
    }
    worker.addEventListener(
      'message',
      (event: MessageEvent<EngineResponse>) => {
        const response = event.data
        if (response.kind === 'coverage') {
          setCoverage(response.coverage)
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

  return { coverage, error }
}
