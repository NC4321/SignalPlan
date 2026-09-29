import type { MapKind } from '../mapView.ts'
import { planChannels, type BandChannelPlan } from '@signalplan/engine'
import {
  addFloor,
  addFloorOpening,
  addSurveySpot,
  adjacentFloorId,
  addWall,
  deleteFloor,
  JOIN_TOLERANCE_M,
  moveFloor,
  stackedFloors,
  type Band,
  type CoverageTarget,
  DEFAULT_REGION,
  type Region,
  type Floor,
  type OpeningMaterial,
  type Plan,
  type Point,
  type WallMaterial,
} from '@signalplan/floorplan'
import {
  applyPatches,
  enablePatches,
  produceWithPatches,
  type Draft,
  type Patch,
} from 'immer'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { DEFAULT_TARGET } from '../quality.ts'
import type { Camera } from './camera.ts'
import { channelPlanRecipe } from './channelPlan.ts'
import {
  DEFAULT_COVERAGE_GOAL,
  suggestionRecipe,
  type CoverageGoal,
  type OptimizerState,
} from './optimizer.ts'
import type { Units } from './units.ts'

enablePatches()

/** A change to the plan. Recipes mutate an Immer draft. */
export type Recipe = (plan: Draft<Plan>) => void

interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
}

/** Older edits are dropped beyond this many undo steps. */
export const HISTORY_LIMIT = 200

/** `calibrate` is the step after adding a tracing image: click two points. */
export type Tool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'floorOpening'
  | 'accessPoint'
  | 'survey'
  | 'calibrate'

/** Sizes for new openings (D19): a 32″ door and a 48″ window. */
export const DEFAULT_OPENING_WIDTH_M = { door: 0.8128, window: 1.2192 } as const

export type SelectionItem = {
  kind:
    'accessPoint' | 'wall' | 'node' | 'opening' | 'floorOpening' | 'surveySpot'
  id: string
}

/** Everything selected; empty when nothing is. */
export type Selection = readonly SelectionItem[]

export const sameItem = (a: SelectionItem, b: SelectionItem) =>
  a.kind === b.kind && a.id === b.id

/**
 * A chain of walls being drawn. Each point after the first was a click; `drew`
 * says whether that click added walls (and so an undo step) or only moved
 * along existing ones.
 */
export type Chain = { point: Point; drew: boolean }[]

/** Settings of the 3D view (D57). Not saved: they reset on reload. */
export interface View3dSettings {
  /** Floors left out of the view. */
  hiddenFloors: readonly string[]
  /** Extra height added between floors, in metres, to see into lower ones. */
  spreadM: number
  /** Walls to the ceiling instead of cut away at 1 m. */
  fullWalls: boolean
}

export interface EditorState {
  plan: Plan
  floorId: string
  /** The 2D editor or the view-only 3D view (D57). Not saved. */
  view: '2d' | '3d'
  view3d: View3dSettings
  band: Band
  /** What the heatmap shows (D64). Not saved, like the band. */
  show: MapKind
  units: Units
  showHeatmap: boolean
  /**
   * Whether the floor below shows faintly under the one on show (D53). Not
   * saved: it resets to on when the page reloads.
   */
  showGhost: boolean
  tool: Tool
  selection: Selection
  /** Undefined until the canvas has a size to fit the plan into. */
  camera: Camera | undefined
  /** Where the pointer is over the plan, in metres. */
  pointer: Point | undefined
  /** Material for new walls: the last one picked (D16). */
  wallMaterial: WallMaterial
  /** The chain of walls being drawn, if any. */
  chain: Chain | undefined
  /**
   * Floor opening tool: the corners clicked so far of the opening being
   * drawn (D54). It becomes an edit only when it closes.
   */
  outline: Point[] | undefined
  /** Calibration: the points clicked on the tracing image so far. */
  calibrationPoints: Point[]
  /** Material for new doors and windows: the last one picked for each. */
  openingMaterial: { door: OpeningMaterial; window: OpeningMaterial }
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** True until the plan is changed after being opened or created. */
  pristine: boolean
  /** The plan's id in the library, or undefined if it hasn't joined it yet. */
  planId: string | undefined
  /** An edit in progress, such as a drag: previews apply to `base`. */
  gesture:
    | { base: Plan; recipe: Recipe | undefined; keepOptimizer: boolean }
    | undefined
  /**
   * A short note for the status bar, such as why a locked access point
   * didn't move (D43). Cleared by the next edit or selection change.
   */
  notice: string | undefined
  /** The optimizer's search, its suggestion, or why it has none (D44). */
  optimizer: OptimizerState | undefined
  /**
   * The channel planner's suggestion for every band with radios (D68),
   * waiting for Apply or Dismiss. Any change to the plan drops it.
   */
  channelPlan: BandChannelPlan[] | undefined
  /**
   * Share of the floor, from 0 to 1, that "How many access points do I
   * need?" aims for (D46). Not saved: it resets when the page reloads.
   */
  coverageGoal: CoverageGoal

  /**
   * Applies one undoable edit. It drops a search or suggestion unless
   * `keepOptimizer` says the edit can't affect it, like the Overlap and
   * Roaming settings (D64).
   */
  edit: (
    label: string,
    recipe: Recipe,
    options?: { keepOptimizer?: boolean },
  ) => void
  /**
   * Starts a gesture; the plan at this moment is what previews build on.
   * `keepOptimizer` is as for `edit`.
   */
  beginGesture: (options?: { keepOptimizer?: boolean }) => void
  /** Shows the gesture's current result, replacing the previous preview. */
  updateGesture: (recipe: Recipe) => void
  /** Commits the gesture's last preview as one undoable edit. */
  endGesture: (label: string) => void
  /** Abandons the gesture and restores the plan it started from. */
  cancelGesture: () => void
  undo: () => void
  redo: () => void
  /**
   * Opens a plan, clearing history. `id` is its id in the library; a new or
   * sample plan has none and is pristine until edited (D21).
   */
  loadPlan: (plan: Plan, options?: { id?: string; pristine?: boolean }) => void
  setPlanId: (id: string) => void
  renamePlan: (name: string) => void
  setCoverageTarget: (target: CoverageTarget) => void
  /** Sets whose channel and power rules the plan follows (D61). */
  setRegion: (region: Region) => void
  /** Allows or disallows 5 GHz DFS channels (D61). */
  setAllowDfs: (allow: boolean) => void

  /** Shows another floor. Not an edit, so it isn't undone (D52). */
  setFloor: (floorId: string) => void
  /** Adds an empty floor on top or at the bottom, and shows it. */
  addFloor: (where: 'above' | 'below') => void
  /** Deletes a floor and everything on it; undo brings it back. */
  deleteFloor: (floorId: string) => void
  /** Swaps a floor with the one above or below it. */
  moveFloor: (floorId: string, direction: 'up' | 'down') => void

  /** Switches between the 2D editor and the 3D view (D57). */
  setView: (view: '2d' | '3d') => void
  setView3d: (settings: Partial<View3dSettings>) => void
  setBand: (band: Band) => void
  setShow: (show: MapKind) => void
  setUnits: (units: Units) => void
  setShowHeatmap: (show: boolean) => void
  setShowGhost: (show: boolean) => void
  setTool: (tool: Tool) => void
  /** Replaces the selection. */
  select: (selection: Selection) => void
  /** Adds an item to the selection, or removes it if already selected. */
  toggleSelected: (item: SelectionItem) => void
  setCamera: (camera: Camera | undefined) => void
  setPointer: (pointer: Point | undefined) => void
  setNotice: (notice: string | undefined) => void
  setOptimizer: (optimizer: OptimizerState | undefined) => void
  setCoverageGoal: (goal: CoverageGoal) => void
  /** Moves or adds the suggested access point as one edit, and selects it. */
  applySuggestion: () => void
  /** Plans every band's channels as a suggestion (D68). */
  planChannels: () => void
  /** Sets the suggested channels and widths as one edit. */
  applyChannelPlan: () => void
  dismissChannelPlan: () => void
  setWallMaterial: (material: WallMaterial) => void
  addCalibrationPoint: (point: Point) => void
  setOpeningMaterial: (
    kind: 'door' | 'window',
    material: OpeningMaterial,
  ) => void
  /** Wall tool: a click at a (snapped) point starts or extends the chain. */
  clickWallPoint: (point: Point) => void
  /** Finishes the chain being drawn, keeping its walls. */
  endChain: () => void
  /**
   * Floor opening tool: a click at a (snapped) point adds a corner; on the
   * first corner it closes the outline.
   */
  clickOutlinePoint: (point: Point) => void
  /**
   * Closes the outline being drawn into a floor opening, if it has at least
   * three corners and some area, or else drops it.
   */
  finishOutline: () => void
  /** Drops the outline being drawn without adding anything. */
  cancelOutline: () => void
  /** Survey tool: adds a spot on the floor on show, and selects it (D71). */
  addSurveySpot: (at: Point) => void
}

const samePoint = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_TOLERANCE_M

/** Would drawing a→b add any wall? Tried on a copy, so nothing changes. */
function wouldAddWall(
  floor: Floor,
  a: Point,
  b: Point,
  material: WallMaterial,
) {
  return addWall(structuredClone(floor), a, b, material).length > 0
}

/**
 * A search or suggestion is for the plan and band as they were, so a change
 * drops it, with a note saying why (D44).
 */
function dropOptimizer(
  optimizer: OptimizerState | undefined,
  why: string,
): Partial<EditorState> {
  switch (optimizer?.status) {
    case 'searching':
      return { optimizer: undefined, notice: `Search stopped: ${why}.` }
    case 'suggestion':
      return { optimizer: undefined, notice: `Suggestion dismissed: ${why}.` }
    case 'message':
      return { optimizer: undefined }
    case undefined:
      return {}
  }
}

/** A channel plan is for the plan as it was, so a change drops it (D68). */
function dropChannelPlan(state: EditorState): Partial<EditorState> {
  return state.channelPlan
    ? {
        channelPlan: undefined,
        notice: 'Channel plan dismissed: the plan changed.',
      }
    : {}
}

const sameSelection = (a: Selection, b: Selection) =>
  a.length === b.length && a.every((item, i) => sameItem(item, b[i]!))

/**
 * The floor to show after a change: the same one if it still exists, or else
 * the remaining floor nearest it in elevation (D52).
 */
function keptFloorId(before: Plan, after: Plan, floorId: string): string {
  if (after.floors.some((f) => f.id === floorId)) return floorId
  const gone = before.floors.find((f) => f.id === floorId)?.elevationM ?? 0
  const nearest = stackedFloors(after.floors).reduce((a, b) =>
    Math.abs(b.elevationM - gone) < Math.abs(a.elevationM - gone) ? b : a,
  )
  return nearest.id
}

/**
 * State after the plan changes to `next`: the floor on show if it still
 * exists (or the nearest), and the selection items that remain on it.
 */
function afterChange(
  state: EditorState,
  next: Plan,
): Pick<EditorState, 'plan' | 'floorId' | 'selection' | 'tool' | 'outline'> {
  const floorId = keptFloorId(state.plan, next, state.floorId)
  // A floor that is now the lowest has no slab to cut (D54).
  const uncut = state.tool === 'floorOpening' && !canCutFloor(next, floorId)
  return {
    plan: next,
    floorId,
    selection:
      floorId === state.floorId
        ? validSelection(next, floorId, state.selection)
        : [],
    tool: uncut ? 'select' : state.tool,
    outline: uncut || floorId !== state.floorId ? undefined : state.outline,
  }
}

/** Drops selected items that no longer exist. */
function validSelection(plan: Plan, floorId: string, selection: Selection) {
  const floor = plan.floors.find((f) => f.id === floorId)
  const exists = (item: SelectionItem) => {
    switch (item.kind) {
      case 'accessPoint':
        return plan.accessPoints.some((ap) => ap.id === item.id)
      case 'wall':
        return floor?.walls.some((w) => w.id === item.id) ?? false
      case 'node':
        return floor?.nodes.some((n) => n.id === item.id) ?? false
      case 'opening':
        return floor?.openings.some((o) => o.id === item.id) ?? false
      case 'floorOpening':
        return floor?.floorOpenings?.some((o) => o.id === item.id) ?? false
      case 'surveySpot':
        return floor?.surveySpots?.some((s) => s.id === item.id) ?? false
    }
  }
  const kept = selection.filter(exists)
  return kept.length === selection.length ? selection : kept
}

export function createEditorStore(
  plan: Plan,
  options: { units?: Units; pristine?: boolean; id?: string } = {},
): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => ({
    plan,
    floorId: plan.floors[0]!.id,
    view: '2d',
    view3d: { hiddenFloors: [], spreadM: 0, fullWalls: false },
    band: '5GHz',
    show: 'signal',
    units: options.units ?? 'metric',
    showHeatmap: true,
    showGhost: true,
    tool: 'select',
    selection: [],
    camera: undefined,
    pointer: undefined,
    wallMaterial: 'drywall',
    chain: undefined,
    outline: undefined,
    openingMaterial: { door: 'wood', window: 'glass' },
    calibrationPoints: [],
    past: [],
    future: [],
    pristine: options.pristine ?? true,
    planId: options.id,
    gesture: undefined,
    notice: undefined,
    optimizer: undefined,
    channelPlan: undefined,
    coverageGoal: DEFAULT_COVERAGE_GOAL,

    edit: (label, recipe, options) => {
      const [next, patches, inverse] = produceWithPatches(get().plan, recipe)
      if (patches.length === 0) return
      set((state) => ({
        ...afterChange(state, next),
        past: [...state.past, { label, patches, inverse }].slice(
          -HISTORY_LIMIT,
        ),
        future: [],
        pristine: false,
        notice: undefined,
        ...(options?.keepOptimizer
          ? {}
          : dropOptimizer(state.optimizer, 'the plan changed')),
        ...dropChannelPlan(state),
      }))
    },

    beginGesture: (options) => {
      set((state) => ({
        gesture: {
          base: state.plan,
          recipe: undefined,
          keepOptimizer: options?.keepOptimizer ?? false,
        },
      }))
    },

    updateGesture: (recipe) => {
      const { gesture } = get()
      if (!gesture) return
      const [next] = produceWithPatches(gesture.base, recipe)
      set((state) => ({
        plan: next,
        gesture: { ...gesture, recipe },
        ...(gesture.keepOptimizer
          ? {}
          : dropOptimizer(state.optimizer, 'the plan changed')),
        ...dropChannelPlan(state),
      }))
    },

    endGesture: (label) => {
      const { gesture } = get()
      if (!gesture) return
      set({ plan: gesture.base, gesture: undefined })
      if (gesture.recipe) {
        get().edit(label, gesture.recipe, {
          keepOptimizer: gesture.keepOptimizer,
        })
      }
    },

    cancelGesture: () => {
      const { gesture } = get()
      if (!gesture) return
      set({ plan: gesture.base, gesture: undefined })
    },

    undo: () => {
      const { past, plan, gesture, chain, outline } = get()
      if (outline) {
        // Mid-outline, undo steps back one corner, as for walls (D16).
        set({ outline: outline.length > 1 ? outline.slice(0, -1) : undefined })
        return
      }
      if (chain) {
        // Mid-chain, undo steps back one click (D16).
        const last = chain.at(-1)!
        if (chain.length === 1 || !last.drew) {
          const rest = chain.slice(0, -1)
          set({ chain: rest.length > 0 ? rest : undefined })
          return
        }
        set({ chain: chain.slice(0, -1) })
      }
      const entry = past.at(-1)
      if (!entry || gesture) return
      const next = applyPatches(plan, entry.inverse)
      set((state) => ({
        ...afterChange(state, next),
        past: state.past.slice(0, -1),
        future: [...state.future, entry],
        ...dropOptimizer(state.optimizer, 'the plan changed'),
        ...dropChannelPlan(state),
      }))
    },

    redo: () => {
      const { future, plan, gesture } = get()
      const entry = future.at(-1)
      if (!entry || gesture) return
      const next = applyPatches(plan, entry.patches)
      set((state) => ({
        chain: undefined,
        ...afterChange(state, next),
        past: [...state.past, entry],
        future: state.future.slice(0, -1),
        ...dropOptimizer(state.optimizer, 'the plan changed'),
        ...dropChannelPlan(state),
      }))
    },

    loadPlan: (next, { id, pristine = false } = {}) => {
      set({
        plan: next,
        planId: id,
        pristine,
        floorId: next.floors[0]!.id,
        past: [],
        future: [],
        gesture: undefined,
        selection: [],
        camera: undefined,
        chain: undefined,
        outline: undefined,
        optimizer: undefined,
        channelPlan: undefined,
      })
    },

    setPlanId: (planId) => set({ planId }),

    renamePlan: (name) => {
      const trimmed = name.trim()
      if (trimmed === '' || trimmed === get().plan.name) return
      get().edit('Rename plan', (draft) => {
        draft.name = trimmed.slice(0, 200)
      })
    },

    setCoverageTarget: (target) => {
      if (target === (get().plan.coverageTarget ?? DEFAULT_TARGET)) return
      get().edit('Change coverage target', (draft) => {
        draft.coverageTarget = target
      })
    },

    setRegion: (region) => {
      if (region === (get().plan.region ?? DEFAULT_REGION)) return
      get().edit('Change region', (draft) => {
        draft.region = region
      })
    },

    setAllowDfs: (allow) => {
      if (allow === (get().plan.allowDfs ?? false)) return
      get().edit(
        allow ? 'Allow DFS channels' : 'Disallow DFS channels',
        (draft) => {
          if (allow) draft.allowDfs = true
          else delete draft.allowDfs
        },
      )
    },

    setFloor: (floorId) => {
      const state = get()
      if (floorId === state.floorId || state.gesture) return
      if (!state.plan.floors.some((f) => f.id === floorId)) return
      set({
        floorId,
        selection: [],
        chain: undefined,
        outline: undefined,
        calibrationPoints: [],
        // The lowest floor has no slab to cut (D54).
        tool:
          state.tool === 'calibrate' ||
          (state.tool === 'floorOpening' && !canCutFloor(state.plan, floorId))
            ? 'select'
            : state.tool,
        // A search or suggestion covers the whole home, so it stays (D55).
        notice: undefined,
      })
    },

    addFloor: (where) => {
      let id: string | undefined
      get().edit(
        where === 'above' ? 'Add floor above' : 'Add floor below',
        (draft) => {
          id = addFloor(draft, where)
        },
      )
      if (id) get().setFloor(id)
    },

    deleteFloor: (floorId) => {
      const { plan } = get()
      const floor = plan.floors.find((f) => f.id === floorId)
      if (!floor || plan.floors.length <= 1) return
      get().edit(`Delete ${floor.name}`, (draft) => {
        deleteFloor(draft, floorId)
      })
      set({
        notice: `Deleted ${floor.name} and everything on it. Undo brings it back.`,
      })
    },

    moveFloor: (floorId, direction) => {
      const floor = get().plan.floors.find((f) => f.id === floorId)
      if (!floor) return
      get().edit(
        `Move ${floor.name} ${direction}`,
        (draft) => void moveFloor(draft, floorId, direction),
      )
    },

    setView: (view) =>
      set((state) =>
        view === state.view || state.gesture
          ? {}
          : {
              view,
              // The 3D view is for looking, so drawing in progress ends.
              chain: undefined,
              outline: undefined,
              calibrationPoints: [],
              tool: state.tool === 'calibrate' ? 'select' : state.tool,
            },
      ),
    setView3d: (settings) =>
      set((state) => ({ view3d: { ...state.view3d, ...settings } })),
    setBand: (band) =>
      set((state) =>
        band === state.band
          ? {}
          : { band, ...dropOptimizer(state.optimizer, 'the band changed') },
      ),
    setShow: (show) => set({ show }),
    setUnits: (units) => set({ units }),
    setShowHeatmap: (showHeatmap) => set({ showHeatmap }),
    setShowGhost: (showGhost) => set({ showGhost }),
    setTool: (tool) =>
      set((state) =>
        tool === 'floorOpening' && !canCutFloor(state.plan, state.floorId)
          ? {}
          : {
              tool,
              chain: undefined,
              outline: undefined,
              calibrationPoints: [],
            },
      ),
    addCalibrationPoint: (point) =>
      set((state) => ({
        calibrationPoints: [...state.calibrationPoints, point].slice(-2),
      })),
    select: (selection) =>
      set((state) => ({
        selection,
        notice: sameSelection(state.selection, selection)
          ? state.notice
          : undefined,
      })),
    toggleSelected: (item) =>
      set((state) => ({
        selection: state.selection.some((s) => sameItem(s, item))
          ? state.selection.filter((s) => !sameItem(s, item))
          : [...state.selection, item],
      })),
    setCamera: (camera) => set({ camera }),
    setPointer: (pointer) => set({ pointer }),
    setNotice: (notice) => set({ notice }),
    setOptimizer: (optimizer) => set({ optimizer }),
    setCoverageGoal: (coverageGoal) => set({ coverageGoal }),
    applySuggestion: () => {
      const { optimizer, plan } = get()
      if (optimizer?.status !== 'suggestion') return
      const { suggestion } = optimizer
      const only =
        suggestion.moves.length === 1 ? suggestion.moves[0] : undefined
      set({ optimizer: undefined })
      get().edit(
        !only
          ? 'Apply the suggested spots'
          : only.apId === undefined
            ? `Add ${only.name} at the suggested spot`
            : `Move ${only.name} to the suggested spot`,
        suggestionRecipe(suggestion),
      )
      // Select everything that moved or was added on the floor on show.
      const { floorId } = get()
      const added = get().plan.accessPoints.filter(
        (ap) => !plan.accessPoints.some((old) => old.id === ap.id),
      )
      const ids = [
        ...suggestion.moves.flatMap((m) =>
          m.apId && m.to.floorId === floorId ? [m.apId] : [],
        ),
        ...added.filter((ap) => ap.floorId === floorId).map((ap) => ap.id),
      ]
      get().select(ids.map((id) => ({ kind: 'accessPoint', id })))
    },
    planChannels: () => {
      set({ channelPlan: planChannels(get().plan), notice: undefined })
    },
    applyChannelPlan: () => {
      const { channelPlan } = get()
      if (!channelPlan) return
      set({ channelPlan: undefined })
      get().edit('Apply the channel plan', channelPlanRecipe(channelPlan))
    },
    dismissChannelPlan: () => set({ channelPlan: undefined }),
    setWallMaterial: (wallMaterial) => set({ wallMaterial }),
    setOpeningMaterial: (kind, material) =>
      set((state) => ({
        openingMaterial: { ...state.openingMaterial, [kind]: material },
      })),

    clickWallPoint: (point) => {
      const { chain, plan, floorId, wallMaterial } = get()
      if (!chain) {
        set({ chain: [{ point, drew: false }], selection: [] })
        return
      }
      const anchor = chain.at(-1)!.point
      if (samePoint(anchor, point)) return // e.g. the second click of a double-click

      const floor = plan.floors.find((f) => f.id === floorId)!
      const drew = wouldAddWall(floor, anchor, point, wallMaterial)
      if (drew) {
        get().edit('Draw wall', (draft) => {
          const target = draft.floors.find((f) => f.id === floorId)!
          addWall(target, anchor, point, wallMaterial)
        })
      }
      // Clicking the chain's first corner closes the room and ends the chain.
      const closes = chain.length >= 2 && samePoint(chain[0]!.point, point)
      set({ chain: closes ? undefined : [...chain, { point, drew }] })
    },

    endChain: () => set({ chain: undefined }),

    clickOutlinePoint: (point) => {
      const { outline } = get()
      if (!outline) {
        set({ outline: [point], selection: [] })
        return
      }
      if (samePoint(outline.at(-1)!, point)) return // e.g. a double-click
      if (outline.length >= 3 && samePoint(outline[0]!, point)) {
        get().finishOutline()
        return
      }
      set({ outline: [...outline, point] })
    },

    finishOutline: () => {
      const { outline, floorId } = get()
      set({ outline: undefined })
      if (!outline) return
      let created: string | undefined
      get().edit('Add floor opening', (draft) => {
        const target = draft.floors.find((f) => f.id === floorId)!
        created = addFloorOpening(target, outline)
      })
      if (created) get().select([{ kind: 'floorOpening', id: created }])
    },

    cancelOutline: () => set({ outline: undefined }),

    addSurveySpot: (at) => {
      const { floorId } = get()
      let created: string | undefined
      // Survey spots don't change coverage, so a suggestion stays (D71).
      get().edit(
        'Add survey spot',
        (draft) => {
          created = addSurveySpot(draft, floorId, at)
        },
        { keepOptimizer: true },
      )
      if (created) get().select([{ kind: 'surveySpot', id: created }])
    },
  }))
}

/**
 * Whether a floor has a slab worth cutting: any floor but the lowest, whose
 * slab no signal crosses (D51, D54).
 */
export function canCutFloor(plan: Plan, floorId: string): boolean {
  return adjacentFloorId(plan.floors, floorId, -1) !== undefined
}

/**
 * While tracing, the heatmap would cover the image (D22), so it's hidden when
 * calibrating, and on the Select tool with nothing selected while the floor's
 * image shows. The Heatmap setting itself is left alone.
 */
export function tracingHidesHeatmap(
  state: Pick<EditorState, 'plan' | 'floorId' | 'tool' | 'selection'>,
): boolean {
  if (state.tool === 'calibrate') return true
  const background = state.plan.floors.find(
    (f) => f.id === state.floorId,
  )?.background
  return (
    state.tool === 'select' &&
    state.selection.length === 0 &&
    background?.visible === true
  )
}

/** Whether the heatmap is drawn: the setting, unless tracing hides it. */
export const heatmapShown = (
  state: Pick<
    EditorState,
    'plan' | 'floorId' | 'tool' | 'selection' | 'showHeatmap'
  >,
) => state.showHeatmap && !tracingHidesHeatmap(state)

/**
 * The floor drawn faintly under the one on show (D53): the one directly
 * below, if there is one and the setting is on.
 */
export function ghostFloor(
  state: Pick<EditorState, 'plan' | 'floorId' | 'showGhost'>,
): Floor | undefined {
  if (!state.showGhost) return undefined
  const below = adjacentFloorId(state.plan.floors, state.floorId, -1)
  return state.plan.floors.find((f) => f.id === below)
}
