// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Autosaver } from './autosave.ts'
import { PlanLibrary } from './library.ts'
import { blankPlan, samplePlan } from './persistence.ts'
import { createEditorStore } from './store.ts'

let library: PlanLibrary
let counter = 0
beforeEach(async () => {
  library = (await PlanLibrary.open(`autosave-${counter++}`))!
})
afterEach(() => library.close())

function setup(options: Parameters<typeof createEditorStore>[1] = {}) {
  const store = createEditorStore(samplePlan(), options)
  const autosaver = new Autosaver(store, library, 0)
  const stop = autosaver.start()
  return { store, autosaver, stop }
}

const moveRouter = (plan: { accessPoints: { x: number }[] }) => {
  plan.accessPoints[0]!.x += 1
}

describe('Autosaver', () => {
  it('adds a new plan to the library on its first edit', async () => {
    const { store, autosaver, stop } = setup()
    await autosaver.flush()
    expect(await library.list()).toEqual([])

    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    const plans = await library.list()
    expect(plans).toHaveLength(1)
    expect(store.getState().planId).toBe(plans[0]?.id)
    expect(autosaver.getStatus()).toBe('saved')
    stop()
  })

  it('saves later edits to the same plan', async () => {
    const { store, autosaver, stop } = setup()
    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    const plans = await library.list()
    expect(plans).toHaveLength(1)
    const opened = await library.open(plans[0]!.id)
    expect(
      opened.kind === 'plan' && opened.plan.accessPoints[0]!.x,
    ).toBeCloseTo(7.6, 9)
    stop()
  })

  it('does not save a newly opened plan until it changes', async () => {
    const { store, autosaver, stop } = setup()
    store.getState().loadPlan(blankPlan(), { pristine: true })
    await autosaver.flush()
    expect(await library.list()).toEqual([])
    expect(autosaver.getStatus()).toBe('idle')
    stop()
  })

  it('waits for the end of a drag', async () => {
    const { store, autosaver, stop } = setup()
    store.getState().beginGesture()
    store.getState().updateGesture(moveRouter)
    await autosaver.flush()
    expect(await library.list()).toEqual([])
    store.getState().endGesture('Move')
    await autosaver.flush()
    expect(await library.list()).toHaveLength(1)
    stop()
  })

  it('reports that nothing is saved without a library', async () => {
    const store = createEditorStore(samplePlan())
    const autosaver = new Autosaver(store, undefined, 0)
    const stop = autosaver.start()
    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    expect(autosaver.getStatus()).toBe('unavailable')
    stop()
  })

  it('has no problem to report without one (D91)', async () => {
    const { store, autosaver, stop } = setup()
    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    expect(autosaver.getProblem()).toBeUndefined()
    stop()
  })

  it('reports a blocked browser from the start', () => {
    const store = createEditorStore(samplePlan())
    const autosaver = new Autosaver(store, undefined, 0)
    expect(autosaver.getProblem()).toBe('unavailable')
    expect(autosaver.canRetry).toBe(false)
  })

  it('reports a failing save once, keeps it while editing, and clears it when saving works', async () => {
    const { store, autosaver, stop } = setup()
    const save = vi.spyOn(library, 'save').mockResolvedValue('full')
    const seen: unknown[] = []
    let shown = autosaver.getProblem()
    autosaver.subscribe(() => {
      // What the notice would re-render on: only changes of the problem.
      if (autosaver.getProblem() === shown) return
      shown = autosaver.getProblem()
      seen.push(shown)
    })

    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    expect(autosaver.getProblem()).toBe('full')

    // Keep editing: the problem stays, and listeners hear of it once.
    for (let i = 0; i < 3; i++) {
      store.getState().edit('Move', moveRouter)
      await autosaver.flush()
    }
    expect(autosaver.getProblem()).toBe('full')
    expect(seen).toEqual(['full'])
    expect(save.mock.calls.length).toBeGreaterThan(1)

    // Storage works again: the next save clears it, with no edit needed when
    // the person asks for a retry.
    save.mockRestore()
    await autosaver.retry()
    expect(autosaver.getProblem()).toBeUndefined()
    expect(autosaver.getStatus()).toBe('saved')
    expect(await library.list()).toHaveLength(1)
    stop()
  })

  it('counts a save that throws as a failure', async () => {
    const { store, autosaver, stop } = setup()
    vi.spyOn(library, 'save').mockRejectedValue(new Error('disk on fire'))
    store.getState().edit('Move', moveRouter)
    await autosaver.flush()
    expect(autosaver.getProblem()).toBe('unavailable')
    stop()
  })
})
