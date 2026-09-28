import type {
  Coverage,
  EngineRequest,
  EngineResponse,
} from '@signalplan/engine'
import type { Band, Plan } from '@signalplan/floorplan'
import { useEffect, useRef, useState } from 'react'

/**
 * Coverage of every floor, for the 3D view (D57), worked out one floor at a
 * time in its own worker while `enabled`. When the plan or band changes,
 * the floors still to do are replaced by those of the new plan; results
 * already shown stay until their floor is redone, and floors that no longer
 * exist are dropped.
 */
export function useFloorsCoverage(
  plan: Plan,
  band: Band,
  enabled: boolean,
): ReadonlyMap<string, Coverage> {
  const [coverages, setCoverages] = useState<ReadonlyMap<string, Coverage>>(
    () => new Map(),
  )
  const queue = useRef<(job: { plan: Plan; band: Band }) => void>(undefined)

  useEffect(() => {
    if (!enabled) return
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })
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
        if (response.kind === 'coverage') {
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
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) queue.current?.({ plan, band })
  }, [plan, band, enabled])

  return coverages
}
