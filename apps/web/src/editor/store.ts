import {
  addWall,
  JOIN_TOLERANCE_M,
  type Band,
  type Floor,
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

export type Tool = 'select' | 'wall'

export type Selection = { kind: 'accessPoint'; id: string } | undefined

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
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** An edit in progress, such as a drag: previews apply to `base`. */
  gesture: { base: Plan; recipe: Recipe | undefined } | undefined

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
  /** Replaces the plan and clears history, as when opening a file. */
  loadPlan: (plan: Plan) => void

  setBand: (band: Band) => void
  setUnits: (units: Units) => void
  setShowHeatmap: (show: boolean) => void
  setTool: (tool: Tool) => void
  select: (selection: Selection) => void
  setCamera: (camera: Camera | undefined) => void
  setPointer: (pointer: Point | undefined) => void
  setWallMaterial: (material: WallMaterial) => void
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

/** Clears the selection if what it points at no longer exists. */
function validSelection(plan: Plan, selection: Selection): Selection {
  if (selection?.kind === 'accessPoint') {
    return plan.accessPoints.some((ap) => ap.id === selection.id)
      ? selection
      : undefined
  }
  return selection
}

export function createEditorStore(plan: Plan): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => ({
    plan,
    floorId: plan.floors[0]!.id,
    band: '5GHz',
    units: 'metric',
    showHeatmap: true,
    tool: 'select',
    selection: undefined,
    camera: undefined,
    pointer: undefined,
    wallMaterial: 'drywall',
    chain: undefined,
    past: [],
    future: [],
    gesture: undefined,

    edit: (label, recipe) => {
      const [next, patches, inverse] = produceWithPatches(get().plan, recipe)
      if (patches.length === 0) return
      set((state) => ({
        plan: next,
        past: [...state.past, { label, patches, inverse }].slice(
          -HISTORY_LIMIT,
        ),
        future: [],
        selection: validSelection(next, state.selection),
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
        selection: validSelection(next, state.selection),
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
        selection: validSelection(next, state.selection),
      }))
    },

    loadPlan: (next) => {
      set({
        plan: next,
        floorId: next.floors[0]!.id,
        past: [],
        future: [],
        gesture: undefined,
        selection: undefined,
        camera: undefined,
        chain: undefined,
      })
    },

    setBand: (band) => set({ band }),
    setUnits: (units) => set({ units }),
    setShowHeatmap: (showHeatmap) => set({ showHeatmap }),
    setTool: (tool) => set({ tool, chain: undefined }),
    select: (selection) => set({ selection }),
    setCamera: (camera) => set({ camera }),
    setPointer: (pointer) => set({ pointer }),
    setWallMaterial: (wallMaterial) => set({ wallMaterial }),

    clickWallPoint: (point) => {
      const { chain, plan, floorId, wallMaterial } = get()
      if (!chain) {
        set({ chain: [{ point, drew: false }], selection: undefined })
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
