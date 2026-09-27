import { parsePlan, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import { describe, expect, it } from 'vitest'
import { createEditorStore, HISTORY_LIMIT } from './store.ts'

function sample(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) throw new Error('fixture is invalid')
  return result.plan
}

const routerX = (plan: Plan) => plan.accessPoints[0]!.x

const moveRouterTo = (x: number) => (plan: Plan) => {
  plan.accessPoints[0]!.x = x
}

describe('edit, undo and redo', () => {
  it('undoes and redoes an edit', () => {
    const store = createEditorStore(sample())
    const original = routerX(store.getState().plan)
    store.getState().edit('Move router', moveRouterTo(9))
    expect(routerX(store.getState().plan)).toBe(9)

    store.getState().undo()
    expect(routerX(store.getState().plan)).toBe(original)
    expect(store.getState().future.map((e) => e.label)).toEqual(['Move router'])

    store.getState().redo()
    expect(routerX(store.getState().plan)).toBe(9)
  })

  it('clears redo history after a new edit', () => {
    const store = createEditorStore(sample())
    store.getState().edit('a', moveRouterTo(1))
    store.getState().undo()
    store.getState().edit('b', moveRouterTo(2))
    expect(store.getState().future).toEqual([])
  })

  it('ignores edits that change nothing', () => {
    const store = createEditorStore(sample())
    store.getState().edit('noop', () => {})
    expect(store.getState().past).toEqual([])
  })

  it('keeps at most HISTORY_LIMIT undo steps', () => {
    const store = createEditorStore(sample())
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      store.getState().edit(`step ${i}`, moveRouterTo(i))
    }
    const { past } = store.getState()
    expect(past).toHaveLength(HISTORY_LIMIT)
    expect(past[0]?.label).toBe('step 6')
  })

  it('does nothing when there is nothing to undo or redo', () => {
    const store = createEditorStore(sample())
    const before = store.getState().plan
    store.getState().undo()
    store.getState().redo()
    expect(store.getState().plan).toBe(before)
  })
})

describe('gestures', () => {
  it('commits a whole drag as one undo step', () => {
    const store = createEditorStore(sample())
    const original = routerX(store.getState().plan)
    store.getState().beginGesture()
    for (const x of [3, 4, 5, 6])
      store.getState().updateGesture(moveRouterTo(x))
    expect(routerX(store.getState().plan)).toBe(6)
    expect(store.getState().past).toEqual([])

    store.getState().endGesture('Move router')
    expect(store.getState().past).toHaveLength(1)
    store.getState().undo()
    expect(routerX(store.getState().plan)).toBe(original)
  })

  it('restores the starting plan when cancelled', () => {
    const store = createEditorStore(sample())
    const before = store.getState().plan
    store.getState().beginGesture()
    store.getState().updateGesture(moveRouterTo(7))
    store.getState().cancelGesture()
    expect(store.getState().plan).toBe(before)
    expect(store.getState().past).toEqual([])
  })

  it('records nothing for a gesture without changes', () => {
    const store = createEditorStore(sample())
    store.getState().beginGesture()
    store.getState().endGesture('Nothing')
    expect(store.getState().past).toEqual([])
  })
})

describe('selection', () => {
  it('clears a selection whose object disappears on undo', () => {
    const store = createEditorStore(sample())
    store.getState().edit('Add AP', (plan) => {
      plan.accessPoints.push({ ...plan.accessPoints[0]!, id: 'extra' })
    })
    store.getState().select({ kind: 'accessPoint', id: 'extra' })
    store.getState().undo()
    expect(store.getState().selection).toBeUndefined()
  })
})

describe('loadPlan', () => {
  it('replaces the plan and clears history', () => {
    const store = createEditorStore(sample())
    store.getState().edit('a', moveRouterTo(1))
    const fresh = sample()
    store.getState().loadPlan(fresh)
    expect(store.getState().plan).toBe(fresh)
    expect(store.getState().past).toEqual([])
  })
})
