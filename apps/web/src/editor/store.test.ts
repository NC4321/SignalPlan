import {
  parsePlan,
  setRadioChannel,
  setRadioWidth,
  type Plan,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import { describe, expect, it } from 'vitest'
import {
  deleteRecipe,
  moveSurveySpotRecipe,
  onlySurveySpots,
} from './selectTool.ts'
import {
  createEditorStore,
  ghostFloor,
  heatmapFaded,
  HISTORY_LIMIT,
} from './store.ts'

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

  it('ignores edits while a gesture is open, such as Delete mid-drag', () => {
    const store = createEditorStore(sample())
    const id = store.getState().plan.accessPoints[0]!.id
    store.getState().beginGesture()
    store.getState().updateGesture(moveRouterTo(4))
    store.getState().edit('Delete', (plan) => {
      plan.accessPoints = plan.accessPoints.filter((ap) => ap.id !== id)
    })
    // The preview is untouched, so the router doesn't vanish mid-drag.
    expect(store.getState().plan.accessPoints.map((ap) => ap.id)).toContain(id)
    expect(store.getState().past).toEqual([])

    store.getState().updateGesture(moveRouterTo(5))
    store.getState().endGesture('Move router')
    expect(routerX(store.getState().plan)).toBe(5)
    expect(store.getState().past.map((e) => e.label)).toEqual(['Move router'])
  })

  it('accepts edits again once the gesture ends', () => {
    const store = createEditorStore(sample())
    store.getState().beginGesture()
    store.getState().cancelGesture()
    store.getState().edit('Move router', moveRouterTo(2))
    expect(routerX(store.getState().plan)).toBe(2)
    expect(store.getState().past).toHaveLength(1)
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

describe('setRegion and setAllowDfs', () => {
  it('sets the region as an undoable edit, skipping no-op changes', () => {
    const store = createEditorStore({ ...sample(), region: undefined })
    // No region counts as the US.
    store.getState().setRegion('US')
    expect(store.getState().past).toHaveLength(0)
    store.getState().setRegion('EU')
    expect(store.getState().plan.region).toBe('EU')
    expect(store.getState().past.at(-1)?.label).toBe('Change region')
    store.getState().undo()
    expect(store.getState().plan.region).toBeUndefined()
  })

  it('stores DFS only while it is allowed', () => {
    const store = createEditorStore(sample())
    store.getState().setAllowDfs(false)
    expect(store.getState().past).toHaveLength(0)
    store.getState().setAllowDfs(true)
    expect(store.getState().plan.allowDfs).toBe(true)
    expect(store.getState().past.at(-1)?.label).toBe('Allow DFS channels')
    store.getState().setAllowDfs(false)
    expect('allowDfs' in store.getState().plan).toBe(false)
    store.getState().undo()
    expect(store.getState().plan.allowDfs).toBe(true)
  })
})

describe('setShow', () => {
  it('switches the map without an undo step (D64)', () => {
    const store = createEditorStore(sample())
    expect(store.getState().show).toBe('signal')
    store.getState().setShow('roaming')
    expect(store.getState().show).toBe('roaming')
    expect(store.getState().past).toHaveLength(0)
  })
})

describe('edit with keepOptimizer', () => {
  it('keeps a suggestion for edits that can’t affect it (D64)', () => {
    const store = createEditorStore(sample())
    store.setState({ optimizer: { status: 'message', text: 'x' } })
    store
      .getState()
      .edit(
        'Change roaming threshold',
        (d) => void (d.roamThresholdDbm = -75),
        {
          keepOptimizer: true,
        },
      )
    expect(store.getState().optimizer).toBeDefined()
    store.getState().edit('Rename', (d) => void (d.name = 'Other'))
    expect(store.getState().optimizer).toBeUndefined()
  })
})

describe('channels', () => {
  it('sets a width and channel, each as one undoable edit', () => {
    const store = createEditorStore(sample())
    const id = store.getState().plan.accessPoints[0]!.id
    const radio5 = () =>
      store
        .getState()
        .plan.accessPoints[0]!.radios.find((r) => r.band === '5GHz')
    store.getState().edit('Change 5 GHz width', (draft) => {
      setRadioWidth(draft, id, '5GHz', 80)
    })
    store.getState().edit('Change 5 GHz channel', (draft) => {
      setRadioChannel(draft, id, '5GHz', 42)
    })
    expect(radio5()).toMatchObject({ channel: 42, channelWidthMHz: 80 })
    store.getState().undo()
    expect(radio5()).toEqual({ band: '5GHz', channelWidthMHz: 80 })
    store.getState().undo()
    expect(radio5()).toEqual({ band: '5GHz' })
  })

  it('keeps hand-set channels when the region or DFS changes (D63)', () => {
    const plan = sample()
    plan.region = 'US'
    plan.allowDfs = true
    plan.accessPoints[0]!.radios = [
      { band: '5GHz', channel: 52, channelWidthMHz: 20 },
    ]
    const store = createEditorStore(plan)
    store.getState().setAllowDfs(false)
    store.getState().setRegion('EU')
    expect(store.getState().plan.accessPoints[0]!.radios).toEqual([
      { band: '5GHz', channel: 52, channelWidthMHz: 20 },
    ])
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

  it('resets what belonged to the plan that was open', () => {
    const store = createEditorStore(sample())
    const floorId = store.getState().plan.floors[0]!.id
    store.getState().setTool('calibrate')
    store.getState().addCalibrationPoint({ x: 1, y: 1 })
    store.getState().setPlaceScan(() => {})
    store.getState().setView3d({ hiddenFloors: [floorId] })
    store.getState().setNotice('Scan not imported.')

    store.getState().loadPlan(sample(), { pristine: true })
    const state = store.getState()
    expect(state.tool).toBe('select')
    expect(state.calibrationPoints).toEqual([])
    expect(state.placeScan).toBeUndefined()
    expect(state.view3d.hiddenFloors).toEqual([])
    expect(state.notice).toBeUndefined()
  })

  it('drops the floor opening tool when opening a plan with one floor', () => {
    const store = createEditorStore(sample())
    store.getState().addFloor('above')
    store.getState().setTool('floorOpening')
    expect(store.getState().tool).toBe('floorOpening')
    store.getState().loadPlan(sample())
    expect(store.getState().tool).toBe('select')
  })

  it('keeps the view settings, which are the person’s, not the plan’s', () => {
    const store = createEditorStore(sample(), { units: 'imperial' })
    store.getState().setBand('2.4GHz')
    store.getState().setShow('interference')
    store.getState().setView('3d')
    store.getState().setView3d({ spreadM: 3, fullWalls: true })
    store.getState().setShowHeatmap(false)
    store.getState().setShowGhost(false)
    store.getState().setWallMaterial('brick')

    store.getState().loadPlan(sample())
    const state = store.getState()
    expect(state.band).toBe('2.4GHz')
    expect(state.show).toBe('interference')
    expect(state.units).toBe('imperial')
    expect(state.view).toBe('3d')
    expect(state.view3d).toEqual({
      hiddenFloors: [],
      spreadM: 3,
      fullWalls: true,
    })
    expect(state.showHeatmap).toBe(false)
    expect(state.showGhost).toBe(false)
    expect(state.wallMaterial).toBe('brick')
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

describe('notice', () => {
  it('clears on the next edit or a new selection, not a repeat one', () => {
    const store = createEditorStore(sample())
    const router = {
      kind: 'accessPoint',
      id: sample().accessPoints[0]!.id,
    } as const
    store.getState().select([router])
    store.getState().setNotice('Locked')
    store.getState().select([router])
    expect(store.getState().notice).toBe('Locked')
    store.getState().select([])
    expect(store.getState().notice).toBeUndefined()

    store.getState().setNotice('Locked')
    store.getState().edit('Move router', moveRouterTo(3))
    expect(store.getState().notice).toBeUndefined()
  })
})

describe('floors (D52)', () => {
  it('adds a floor above and shows it, as one undo step', () => {
    const store = createEditorStore(sample())
    store.getState().select([{ kind: 'accessPoint', id: 'router' }])
    store.getState().addFloor('above')
    const state = store.getState()
    expect(state.plan.floors).toHaveLength(2)
    const added = state.plan.floors[1]!
    expect(state.floorId).toBe(added.id)
    expect(state.selection).toEqual([])
    expect(state.past.at(-1)!.label).toBe('Add floor above')
    // Undo removes it and goes back to the nearest floor.
    store.getState().undo()
    expect(store.getState().plan.floors).toHaveLength(1)
    expect(store.getState().floorId).toBe('main')
  })

  it('switches floors without an undo step, dropping selection and chain', () => {
    const store = createEditorStore(sample())
    store.getState().addFloor('below')
    const basement = store.getState().floorId
    store.getState().setFloor('main')
    store.getState().select([{ kind: 'accessPoint', id: 'router' }])
    store.getState().setTool('wall')
    store.getState().clickWallPoint({ x: 0, y: 0 })
    const steps = store.getState().past.length
    store.getState().setFloor(basement)
    const state = store.getState()
    expect(state.floorId).toBe(basement)
    expect(state.selection).toEqual([])
    expect(state.chain).toBeUndefined()
    expect(state.past).toHaveLength(steps)
  })

  it('ignores an unknown floor', () => {
    const store = createEditorStore(sample())
    store.getState().setFloor('nope')
    expect(store.getState().floorId).toBe('main')
  })

  it('keeps a search when the floor changes: it covers the whole home (D55)', () => {
    const store = createEditorStore(sample())
    store.getState().addFloor('above')
    const searching = {
      status: 'searching',
      fraction: 0.5,
      what: 'a spot',
    } as const
    store.getState().setOptimizer(searching)
    store.getState().setFloor('main')
    expect(store.getState().optimizer).toEqual(searching)
    expect(store.getState().notice).toBeUndefined()
  })

  it('deletes the floor on show with its access points, and undo restores it', () => {
    const store = createEditorStore(sample())
    store.getState().deleteFloor('main')
    // The last floor stays.
    expect(store.getState().plan.floors).toHaveLength(1)

    store.getState().addFloor('above')
    const upper = store.getState().floorId
    store.getState().edit('Add AP', (plan) => {
      plan.accessPoints.push({
        ...plan.accessPoints[0]!,
        id: 'up-ap',
        floorId: upper,
      })
    })
    store.getState().deleteFloor(upper)
    let state = store.getState()
    expect(state.plan.floors.map((f) => f.id)).toEqual(['main'])
    expect(state.plan.accessPoints.map((ap) => ap.id)).toEqual(['router'])
    expect(state.floorId).toBe('main')
    expect(state.notice).toBe(
      'Deleted Upper floor and everything on it. Undo brings it back.',
    )

    store.getState().undo()
    state = store.getState()
    expect(state.plan.floors).toHaveLength(2)
    expect(state.plan.accessPoints.map((ap) => ap.id)).toContain('up-ap')
  })

  it('moves a floor down the stack as one undo step', () => {
    const store = createEditorStore(sample())
    store.getState().addFloor('above')
    const upper = store.getState().floorId
    store.getState().moveFloor(upper, 'down')
    const byId = (id: string) =>
      store.getState().plan.floors.find((f) => f.id === id)!
    expect(byId(upper).elevationM).toBe(0)
    expect(byId('main').elevationM).toBeGreaterThan(0)
    expect(store.getState().past.at(-1)!.label).toBe('Move Upper floor down')
    store.getState().undo()
    expect(byId('main').elevationM).toBe(0)
  })
})

describe('ghostFloor (D53)', () => {
  it('is the floor directly below, while the setting is on', () => {
    const store = createEditorStore(sample())
    expect(ghostFloor(store.getState())).toBeUndefined()
    store.getState().addFloor('above')
    expect(ghostFloor(store.getState())?.id).toBe('main')
    store.getState().setShowGhost(false)
    expect(ghostFloor(store.getState())).toBeUndefined()
    store.getState().setShowGhost(true)
    // The lowest floor has nothing below.
    store.getState().setFloor('main')
    expect(ghostFloor(store.getState())).toBeUndefined()
  })
})

describe('floor openings (D54)', () => {
  /** The sample home with an upper floor added and on show. */
  function twoStoreys() {
    const store = createEditorStore(sample())
    store.getState().addFloor('above')
    store.getState().setTool('floorOpening')
    return store
  }
  const corners = [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 2 },
    { x: 1, y: 2 },
  ]

  it('adds an opening as one undo step when the first corner is clicked again', () => {
    const store = twoStoreys()
    const steps = store.getState().past.length
    for (const p of corners) store.getState().clickOutlinePoint(p)
    expect(store.getState().outline).toHaveLength(4)
    expect(store.getState().past).toHaveLength(steps)
    store.getState().clickOutlinePoint({ x: 1, y: 1 })
    const state = store.getState()
    expect(state.outline).toBeUndefined()
    expect(state.past).toHaveLength(steps + 1)
    expect(state.past.at(-1)!.label).toBe('Add floor opening')
    const floor = state.plan.floors.find((f) => f.id === state.floorId)!
    expect(floor.floorOpenings).toEqual([{ id: 'hole1', points: corners }])
    expect(state.selection).toEqual([{ kind: 'floorOpening', id: 'hole1' }])
    store.getState().undo()
    const after = store.getState()
    expect(
      after.plan.floors.find((f) => f.id === after.floorId)!.floorOpenings,
    ).toBeUndefined()
    expect(after.selection).toEqual([])
  })

  it('closes on Enter (finishOutline) only with three corners and some area', () => {
    const store = twoStoreys()
    const steps = store.getState().past.length
    store.getState().clickOutlinePoint({ x: 0, y: 0 })
    store.getState().clickOutlinePoint({ x: 1, y: 0 })
    store.getState().finishOutline()
    expect(store.getState().outline).toBeUndefined()
    expect(store.getState().past).toHaveLength(steps)
    for (const p of corners.slice(0, 3)) store.getState().clickOutlinePoint(p)
    store.getState().finishOutline()
    expect(store.getState().past).toHaveLength(steps + 1)
  })

  it('undo steps back one corner while drawing, and Esc drops the outline', () => {
    const store = twoStoreys()
    const steps = store.getState().past.length
    for (const p of corners.slice(0, 3)) store.getState().clickOutlinePoint(p)
    store.getState().undo()
    expect(store.getState().outline).toEqual(corners.slice(0, 2))
    store.getState().cancelOutline()
    expect(store.getState().outline).toBeUndefined()
    expect(store.getState().past).toHaveLength(steps)
  })

  it('is not available on the lowest floor', () => {
    const store = createEditorStore(sample())
    store.getState().setTool('floorOpening')
    expect(store.getState().tool).toBe('select')
    // Switching to the lowest floor leaves the tool.
    const upper = twoStoreys()
    upper.getState().setFloor('main')
    expect(upper.getState().tool).toBe('select')
  })

  it('leaves the tool when the floor below is deleted', () => {
    const store = twoStoreys()
    store.getState().clickOutlinePoint({ x: 0, y: 0 })
    store.getState().deleteFloor('main')
    expect(store.getState().tool).toBe('select')
    expect(store.getState().outline).toBeUndefined()
  })
})

describe('the 3D view (D57)', () => {
  it('switches views without an undo step, ending drawing in progress', () => {
    const store = createEditorStore(sample())
    store.getState().setTool('wall')
    store.getState().clickWallPoint({ x: 0, y: 0 })
    store.getState().setView('3d')
    const state = store.getState()
    expect(state.view).toBe('3d')
    expect(state.chain).toBeUndefined()
    expect(state.past).toEqual([])
    store.getState().setView3d({ spreadM: 2 })
    expect(store.getState().view3d).toEqual({
      hiddenFloors: [],
      spreadM: 2,
      fullWalls: false,
    })
    store.getState().setView('2d')
    expect(store.getState().view).toBe('2d')
    expect(store.getState().view3d.spreadM).toBe(2)
  })
})

describe('survey spots (D71)', () => {
  it('adds a spot as one undo step and selects it; undo drops the selection', () => {
    const store = createEditorStore(sample())
    const steps = store.getState().past.length
    store.getState().setTool('survey')
    store.getState().addSurveySpot({ x: 2, y: 3 })
    const state = store.getState()
    expect(state.past).toHaveLength(steps + 1)
    expect(state.past.at(-1)!.label).toBe('Add survey spot')
    expect(state.plan.floors[0]!.surveySpots).toEqual([
      { id: 'spot1', x: 2, y: 3, readings: [] },
    ])
    expect(state.selection).toEqual([{ kind: 'surveySpot', id: 'spot1' }])
    store.getState().undo()
    expect(store.getState().plan.floors[0]!.surveySpots).toBeUndefined()
    expect(store.getState().selection).toEqual([])
  })

  it('keeps an optimizer search through survey edits, which don’t change coverage', () => {
    const store = createEditorStore(sample())
    const searching = {
      status: 'searching' as const,
      fraction: 0.5,
      what: 'Searching',
    }
    store.getState().setOptimizer(searching)
    store.getState().addSurveySpot({ x: 2, y: 3 })
    const spot = [{ kind: 'surveySpot' as const, id: 'spot1' }]
    store.getState().beginGesture({ keepOptimizer: true })
    store
      .getState()
      .updateGesture(moveSurveySpotRecipe('spot1', { x: 4, y: 3 }))
    store.getState().endGesture('Move survey spot')
    expect(store.getState().plan.floors[0]!.surveySpots![0]).toMatchObject({
      x: 4,
    })
    store.getState().edit('Delete survey spot', deleteRecipe('main', spot), {
      keepOptimizer: onlySurveySpots(spot),
    })
    expect(store.getState().optimizer).toBe(searching)
    // Anything else still stops it.
    store.getState().edit('Move router', moveRouterTo(1))
    expect(store.getState().optimizer).toBeUndefined()
  })

  it('deletes an access point with its readings, and undo brings both back', () => {
    const store = createEditorStore(sample())
    const router = store.getState().plan.accessPoints[0]!
    store.getState().addSurveySpot({ x: 2, y: 3 })
    store.getState().edit('Add a reading', (plan) => {
      plan.floors[0]!.surveySpots![0]!.readings.push({
        apId: router.id,
        band: '5GHz',
        dbm: -55,
      })
    })
    const withReading = store.getState().plan
    store
      .getState()
      .edit(
        'Delete access point',
        deleteRecipe(store.getState().floorId, [
          { kind: 'accessPoint', id: router.id },
        ]),
      )
    expect(store.getState().plan.floors[0]!.surveySpots![0]!.readings).toEqual(
      [],
    )
    store.getState().undo()
    expect(store.getState().plan).toEqual(withReading)
  })
})

describe('heatmapFaded (D74)', () => {
  it('fades with the Survey tool or a spot selected, unless turned off', () => {
    const store = createEditorStore(sample())
    const faded = () => heatmapFaded(store.getState())
    expect(store.getState().fadeHeatmapForSurvey).toBe(true)
    expect(faded()).toBe(false)

    store.getState().setTool('survey')
    expect(faded()).toBe(true)
    store.getState().addSurveySpot({ x: 2, y: 3 })
    store.getState().setTool('select')
    // Back on Select, the new spot is still selected.
    expect(store.getState().selection).toEqual([
      { kind: 'surveySpot', id: 'spot1' },
    ])
    expect(faded()).toBe(true)

    store.getState().setFadeHeatmapForSurvey(false)
    expect(faded()).toBe(false)
    store.getState().setFadeHeatmapForSurvey(true)

    store.getState().select([])
    expect(faded()).toBe(false)
    const router = store.getState().plan.accessPoints[0]!.id
    store.getState().select([{ kind: 'accessPoint', id: router }])
    expect(faded()).toBe(false)

    // Only while the panel shows a survey section, with its checkbox: not
    // with the Survey tool and an access point selected, nor a mixed selection.
    store.getState().setTool('survey')
    store.getState().select([{ kind: 'accessPoint', id: router }])
    expect(faded()).toBe(false)
    store.getState().select([
      { kind: 'surveySpot', id: 'spot1' },
      { kind: 'accessPoint', id: router },
    ])
    expect(faded()).toBe(false)
  })
})
