import { useEffect, useState } from 'react'
import type { StoreApi } from 'zustand'
import { writeSavedPlan, writeUnits, type SaveResult } from './persistence.ts'
import type { EditorState } from './store.ts'

/** Wait this long after the last change before saving, in milliseconds. */
const SAVE_DELAY_MS = 400

export type SaveStatus = SaveResult | 'idle' | 'pending'

/**
 * Saves the plan in this browser shortly after each change, and the units
 * preference as soon as it changes (D20). Changes during a drag are saved
 * once the drag ends.
 */
export function useAutosave(store: StoreApi<EditorState>): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      const { plan, gesture } = store.getState()
      if (gesture) return // the drag's end triggers another change
      setStatus(writeSavedPlan(plan))
    }
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.units !== previous.units) writeUnits(state.units)
      if (state.plan === previous.plan || state.gesture) return
      setStatus('pending')
      clearTimeout(timer)
      timer = setTimeout(save, SAVE_DELAY_MS)
    })
    // Save straight away rather than lose the last change on close.
    const flush = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      save()
    }
    window.addEventListener('pagehide', flush)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [store])

  return status
}
