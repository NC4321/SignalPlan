import { useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand'
import {
  newPlanId,
  saveFailure,
  type PlanLibrary,
  type SaveResult,
} from './library.ts'
import { writeUnits } from './persistence.ts'
import type { EditorState } from './store.ts'

/** Wait this long after the last change before saving, in milliseconds. */
const SAVE_DELAY_MS = 400

export type SaveStatus = SaveResult | 'idle' | 'pending'

/**
 * Why changes aren't being saved, until a save works again (D91): storage is
 * full, the browser blocked it from the start ('blocked': no library at all),
 * or a save failed for another reason once it was working ('failed').
 */
export type SaveProblem = 'full' | 'blocked' | 'failed' | undefined

/**
 * Saves the open plan to the library shortly after each change (D21). A new
 * or sample plan joins the list on its first edit; changes during a drag are
 * saved once the drag ends. The units preference is saved as it changes.
 */
export class Autosaver {
  private status: SaveStatus = 'idle'
  private problem: SaveProblem
  /** A retry by hand failed too, so the notice says so. */
  private retryFailed = false
  private suspended = false
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
    // A browser that blocks storage says so from the start.
    if (!library) this.problem = 'blocked'
  }

  /** Whether a save can be tried again by hand (not when storage is blocked). */
  get canRetry(): boolean {
    return this.library !== undefined
  }

  /**
   * Stops saving for good, for when the editor has crashed (D91): the plan
   * it holds may be what crashed it, and saving it would reopen the crash on
   * reload. What was saved before stays.
   */
  suspend() {
    this.suspended = true
    this.cancel()
  }

  /**
   * Tries saving the open plan again, for the "Try saving again" in the
   * notice. After a failure other than a full disk the connection may have
   * been closed, so it's opened again first.
   */
  async retry(): Promise<SaveStatus> {
    if (this.problem === 'failed') await this.library?.reconnect()
    await this.saveNow(true)
    return this.status
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
  async flush(): Promise<SaveStatus> {
    if (this.timer !== undefined) await this.saveNow()
    await this.saving
    return this.status
  }

  private cancel() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async saveNow(byHand = false) {
    this.cancel()
    const state = this.store.getState()
    if (this.suspended || !this.library || state.pristine || state.gesture) {
      return
    }
    let id = state.planId
    if (!id) {
      id = newPlanId()
      state.setPlanId(id)
    }
    const plan = state.plan
    const library = this.library
    this.saving = this.saving.then(async () => {
      let result: SaveResult
      try {
        result = await library.save(id, plan)
      } catch (error) {
        result = saveFailure(error)
      }
      // The notice follows the last result, not 'pending', so it stays
      // steady while someone keeps editing and clears on the first save that
      // works.
      this.setProblem(
        result === 'saved' ? undefined : result === 'full' ? 'full' : 'failed',
      )
      if (result === 'saved') this.setRetryFailed(false)
      else if (byHand) this.setRetryFailed(true)
      this.setStatus(result)
    })
    await this.saving
  }

  getStatus = (): SaveStatus => this.status

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getProblem = (): SaveProblem => this.problem

  /** Whether the last save tried by hand failed too. */
  getRetryFailed = (): boolean => this.retryFailed

  private setRetryFailed(value: boolean) {
    if (value === this.retryFailed) return
    this.retryFailed = value
    for (const listener of this.listeners) listener()
  }

  private setProblem(problem: SaveProblem) {
    if (problem === this.problem) return
    this.problem = problem
    for (const listener of this.listeners) listener()
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

/** Why saving is failing, if it is; re-renders only when that changes. */
export function useSaveProblem(autosaver: Autosaver): SaveProblem {
  return useSyncExternalStore(autosaver.subscribe, autosaver.getProblem)
}

/** Whether a retry by hand has failed; re-renders only when that changes. */
export function useRetryFailed(autosaver: Autosaver): boolean {
  return useSyncExternalStore(autosaver.subscribe, autosaver.getRetryFailed)
}
