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
    store.getState().select([{ kind: 'accessPoint', id: 'extra' }])
    store.getState().undo()
    expect(store.getState().selection).toEqual([])
  })
})

describe('toggleSelected', () => {
  it('adds and removes items', () => {
    const store = createEditorStore(sample())
    const wall = { kind: 'wall', id: 'living-bed1' } as const
    const node = { kind: 'node', id: 'n1' } as const
    store.getState().toggleSelected(wall)
    store.getState().toggleSelected(node)
    expect(store.getState().selection).toEqual([wall, node])
    store.getState().toggleSelected(wall)
    expect(store.getState().selection).toEqual([node])
  })
})

describe('pristine', () => {
  it('starts pristine and stops being so after an edit', () => {
    const store = createEditorStore(sample())
    expect(store.getState().pristine).toBe(true)
    store.getState().edit('a', moveRouterTo(1))
    expect(store.getState().pristine).toBe(false)
  })

  it('is set by loadPlan only when asked', () => {
    const store = createEditorStore(sample())
    store.getState().loadPlan(sample())
    expect(store.getState().pristine).toBe(false)
    store.getState().loadPlan(sample(), { pristine: true })
    expect(store.getState().pristine).toBe(true)
  })
})

describe('renamePlan', () => {
  it('renames as an undoable edit, ignoring blank names', () => {
    const store = createEditorStore(sample())
    store.getState().renamePlan('  My house ')
    expect(store.getState().plan.name).toBe('My house')
    store.getState().renamePlan('   ')
    expect(store.getState().plan.name).toBe('My house')
    store.getState().undo()
    expect(store.getState().plan.name).toBe('Sample bungalow')
  })
})

describe('setCoverageTarget', () => {
  it('sets the target as an undoable edit, skipping no-op changes', () => {
    const store = createEditorStore(sample())
    // The sample sets no target, so it counts towards Fair.
    store.getState().setCoverageTarget('fair')
    expect(store.getState().past).toHaveLength(0)
    store.getState().setCoverageTarget('good')
    expect(store.getState().plan.coverageTarget).toBe('good')
    expect(store.getState().past.at(-1)?.label).toBe('Change coverage target')
    store.getState().undo()
    expect(store.getState().plan.coverageTarget).toBeUndefined()
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

describe('wall chain', () => {
  const blank = (): Plan => ({
    schemaVersion: 1,
    name: 'Blank',
    floors: [
      {
        id: 'f',
        name: 'Floor',
        elevationM: 0,
        heightM: 2.5,
        nodes: [],
        walls: [],
        openings: [],
      },
    ],
    accessPoints: [],
  })
  const walls = (store: ReturnType<typeof createEditorStore>) =>
    store.getState().plan.floors[0]!.walls.length

  it('draws one wall per click after the first', () => {
    const store = createEditorStore(blank())
    const { clickWallPoint } = store.getState()
    clickWallPoint({ x: 0, y: 0 })
    expect(walls(store)).toBe(0)
    clickWallPoint({ x: 4, y: 0 })
    clickWallPoint({ x: 4, y: 3 })
    expect(walls(store)).toBe(2)
    expect(store.getState().past.map((e) => e.label)).toEqual([
      'Draw wall',
      'Draw wall',
    ])
    expect(store.getState().chain?.at(-1)?.point).toEqual({ x: 4, y: 3 })
  })

  it('uses the chosen material', () => {
    const store = createEditorStore(blank())
    store.getState().setWallMaterial('brick')
    store.getState().clickWallPoint({ x: 0, y: 0 })
    store.getState().clickWallPoint({ x: 2, y: 0 })
    expect(store.getState().plan.floors[0]!.walls[0]!.material).toBe('brick')
  })

  it('closes a room when clicking the first corner, ending the chain', () => {
    const store = createEditorStore(blank())
    for (const p of [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
      { x: 0, y: 0 },
    ]) {
      store.getState().clickWallPoint(p)
    }
    expect(walls(store)).toBe(4)
    expect(store.getState().plan.floors[0]!.nodes).toHaveLength(4)
    expect(store.getState().chain).toBeUndefined()
  })

  it('ignores a repeated click at the same point', () => {
    const store = createEditorStore(blank())
    store.getState().clickWallPoint({ x: 0, y: 0 })
    store.getState().clickWallPoint({ x: 2, y: 0 })
    store.getState().clickWallPoint({ x: 2, y: 0 })
    expect(walls(store)).toBe(1)
    expect(store.getState().chain).toHaveLength(2)
  })

  it('undo mid-chain removes the last wall and keeps drawing from before it', () => {
    const store = createEditorStore(blank())
    store.getState().clickWallPoint({ x: 0, y: 0 })
    store.getState().clickWallPoint({ x: 4, y: 0 })
    store.getState().clickWallPoint({ x: 4, y: 3 })
    store.getState().undo()
    expect(walls(store)).toBe(1)
    expect(store.getState().chain?.at(-1)?.point).toEqual({ x: 4, y: 0 })
    store.getState().undo()
    expect(walls(store)).toBe(0)
    expect(store.getState().chain).toHaveLength(1)
    store.getState().undo()
    expect(store.getState().chain).toBeUndefined()
  })

  it('moves along an existing wall without an undo step', () => {
    const store = createEditorStore(blank())
    store.getState().clickWallPoint({ x: 0, y: 0 })
    store.getState().clickWallPoint({ x: 4, y: 0 })
    store.getState().endChain()
    store.getState().clickWallPoint({ x: 4, y: 0 })
    store.getState().clickWallPoint({ x: 0, y: 0 }) // along the existing wall
    expect(store.getState().past).toHaveLength(1)
    store.getState().undo() // steps back the click, not the first wall
    expect(walls(store)).toBe(1)
  })

  it('ends the chain when switching tools', () => {
    const store = createEditorStore(blank())
    store.getState().setTool('wall')
    store.getState().clickWallPoint({ x: 0, y: 0 })
    store.getState().setTool('select')
    expect(store.getState().chain).toBeUndefined()
  })
})
