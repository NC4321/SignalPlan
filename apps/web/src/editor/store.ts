import {
  addWall,
  JOIN_TOLERANCE_M,
  type Band,
  type CoverageTarget,
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
  'select' | 'wall' | 'door' | 'window' | 'accessPoint' | 'calibrate'

/** Sizes for new openings (D19): a 32″ door and a 48″ window. */
export const DEFAULT_OPENING_WIDTH_M = { door: 0.8128, window: 1.2192 } as const

export type SelectionItem = {
  kind: 'accessPoint' | 'wall' | 'node' | 'opening'
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

export interface EditorState {
  plan: Plan
  floorId: string
  band: Band
  units: Units
  showHeatmap: boolean
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
  gesture: { base: Plan; recipe: Recipe | undefined } | undefined
  /**
   * A short note for the status bar, such as why a locked access point
   * didn't move (D43). Cleared by the next edit or selection change.
   */
  notice: string | undefined

  /** Applies one undoable edit. */
  edit: (label: string, recipe: Recipe) => void
  /** Starts a gesture; the plan at this moment is what previews build on. */
  beginGesture: () => void
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

  setBand: (band: Band) => void
  setUnits: (units: Units) => void
  setShowHeatmap: (show: boolean) => void
  setTool: (tool: Tool) => void
  /** Replaces the selection. */
  select: (selection: Selection) => void
  /** Adds an item to the selection, or removes it if already selected. */
  toggleSelected: (item: SelectionItem) => void
  setCamera: (camera: Camera | undefined) => void
  setPointer: (pointer: Point | undefined) => void
  setNotice: (notice: string | undefined) => void
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

const sameSelection = (a: Selection, b: Selection) =>
  a.length === b.length && a.every((item, i) => sameItem(item, b[i]!))

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
    band: '5GHz',
    units: options.units ?? 'metric',
    showHeatmap: true,
    tool: 'select',
    selection: [],
    camera: undefined,
    pointer: undefined,
    wallMaterial: 'drywall',
    chain: undefined,
    openingMaterial: { door: 'wood', window: 'glass' },
    calibrationPoints: [],
    past: [],
    future: [],
    pristine: options.pristine ?? true,
    planId: options.id,
    gesture: undefined,
    notice: undefined,

    edit: (label, recipe) => {
      const [next, patches, inverse] = produceWithPatches(get().plan, recipe)
      if (patches.length === 0) return
      set((state) => ({
        plan: next,
        past: [...state.past, { label, patches, inverse }].slice(
          -HISTORY_LIMIT,
        ),
        future: [],
        pristine: false,
        selection: validSelection(next, state.floorId, state.selection),
        notice: undefined,
      }))
    },

    beginGesture: () => {
      set((state) => ({ gesture: { base: state.plan, recipe: undefined } }))
    },

    updateGesture: (recipe) => {
      const { gesture } = get()
      if (!gesture) return
      const [next] = produceWithPatches(gesture.base, recipe)
      set({ plan: next, gesture: { base: gesture.base, recipe } })
    },

    endGesture: (label) => {
      const { gesture } = get()
      if (!gesture) return
      set({ plan: gesture.base, gesture: undefined })
      if (gesture.recipe) get().edit(label, gesture.recipe)
    },

    cancelGesture: () => {
      const { gesture } = get()
      if (!gesture) return
      set({ plan: gesture.base, gesture: undefined })
    },

    undo: () => {
      const { past, plan, gesture, chain } = get()
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
        plan: next,
        past: state.past.slice(0, -1),
        future: [...state.future, entry],
        selection: validSelection(next, state.floorId, state.selection),
      }))
    },

    redo: () => {
      const { future, plan, gesture } = get()
      const entry = future.at(-1)
      if (!entry || gesture) return
      const next = applyPatches(plan, entry.patches)
      set((state) => ({
        chain: undefined,
        plan: next,
        past: [...state.past, entry],
        future: state.future.slice(0, -1),
        selection: validSelection(next, state.floorId, state.selection),
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

    setBand: (band) => set({ band }),
    setUnits: (units) => set({ units }),
    setShowHeatmap: (showHeatmap) => set({ showHeatmap }),
    setTool: (tool) => set({ tool, chain: undefined, calibrationPoints: [] }),
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
  }))
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
