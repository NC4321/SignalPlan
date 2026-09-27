import { useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand'
import { newPlanId, type PlanLibrary, type SaveResult } from './library.ts'
import { writeUnits } from './persistence.ts'
import type { EditorState } from './store.ts'

/** Wait this long after the last change before saving, in milliseconds. */
const SAVE_DELAY_MS = 400

export type SaveStatus = SaveResult | 'idle' | 'pending'

/**
 * Saves the open plan to the library shortly after each change (D21). A new
 * or sample plan joins the list on its first edit; changes during a drag are
 * saved once the drag ends. The units preference is saved as it changes.
 */
export class Autosaver {
  private status: SaveStatus = 'idle'
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving: Promise<void> = Promise.resolve()

  private readonly store: StoreApi<EditorState>
  private readonly library: PlanLibrary | undefined
  private readonly delayMs: number

  constructor(
    store: StoreApi<EditorState>,
    library: PlanLibrary | undefined,
    delayMs = SAVE_DELAY_MS,
  ) {
    this.store = store
    this.library = library
    this.delayMs = delayMs
  }

  /** Starts watching the store; returns a function that stops it. */
  start(): () => void {
    const unsubscribe = this.store.subscribe((state, previous) => {
      if (state.units !== previous.units) writeUnits(state.units)
      if (state.plan === previous.plan) return
      if (state.planId !== previous.planId) {
        // Another plan was opened: nothing to save until it changes.
        this.cancel()
        this.setStatus(state.pristine ? 'idle' : 'saved')
        return
      }
      if (state.pristine || state.gesture) return
      this.setStatus(this.library ? 'pending' : 'unavailable')
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.saveNow(), this.delayMs)
    })
    const onHide = () => void this.flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', onHide)
    }
  }

  /** Saves any change still waiting, before the open plan is replaced. */
  async flush(): Promise<void> {
    if (this.timer !== undefined) await this.saveNow()
    await this.saving
  }

  private cancel() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async saveNow() {
    this.cancel()
    const state = this.store.getState()
    if (!this.library || state.pristine || state.gesture) return
    let id = state.planId
    if (!id) {
      id = newPlanId()
      state.setPlanId(id)
    }
    const plan = state.plan
    const library = this.library
    this.saving = this.saving.then(async () => {
      this.setStatus(await library.save(id, plan))
    })
    await this.saving
  }

  getStatus = (): SaveStatus => this.status

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: SaveStatus) {
    if (status === this.status) return
    this.status = status
    for (const listener of this.listeners) listener()
  }
}

/** The autosaver's status, re-rendering when it changes. */
export function useSaveStatus(autosaver: Autosaver): SaveStatus {
  return useSyncExternalStore(autosaver.subscribe, autosaver.getStatus)
}
