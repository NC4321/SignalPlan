import type { PlanIssue } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import { useEditor, useEditorStore } from './editor/context.ts'
import { EditorCanvas } from './editor/EditorCanvas.tsx'
import { Dialog, PlanIssues } from './editor/FileMenu.tsx'
import { rescueSavedPlan } from './editor/persistence.ts'
import { useAutosave } from './editor/useAutosave.ts'
import {
  PropertiesPanel,
  StatusBar,
  TopBar,
  Toolbar,
} from './editor/panels.tsx'
import { deleteRecipe, describeSelection } from './editor/selectTool.ts'
import { isTyping } from './editor/util.ts'
import { useCoverage } from './useCoverage.ts'

function App({
  savedPlanProblem,
}: {
  /** Set when the plan saved in this browser could not be opened. */
  savedPlanProblem?: readonly PlanIssue[] | undefined
}) {
  const store = useEditorStore()
  const saveStatus = useAutosave(store)
  const [problemOpen, setProblemOpen] = useState(savedPlanProblem !== undefined)
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const band = useEditor((s) => s.band)
  const [panelOpen, setPanelOpen] = useState(false)

  const broadcasting = plan.accessPoints.some(
    (ap) =>
      ap.floorId === floorId && ap.radios.some((radio) => radio.band === band),
  )
  const { coverage, error } = useCoverage(plan, floorId, band)

  // Global shortcuts: undo, redo and tools.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const state = store.getState()
      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
      } else if (mod && key === 'y') {
        event.preventDefault()
        state.redo()
      } else if (!mod && !event.altKey && key === 'v') {
        state.setTool('select')
      } else if (!mod && !event.altKey && key === 'w') {
        state.setTool('wall')
      } else if (!mod && !event.altKey && key === 'd') {
        state.setTool('door')
      } else if (!mod && !event.altKey && key === 'n') {
        state.setTool('window')
      } else if (key === 'enter' && state.chain) {
        state.endChain()
      } else if (key === 'delete' || key === 'backspace') {
        const removable = state.selection.filter(
          (i) => i.kind !== 'accessPoint',
        )
        if (removable.length === 0) return
        event.preventDefault()
        state.edit(
          `Delete ${describeSelection(removable)}`,
          deleteRecipe(state.floorId, removable),
        )
      } else if (key === 'escape') {
        // Esc finishes the chain; pressed again, it returns to Select (D16).
        if (state.chain) state.endChain()
        else if (state.tool !== 'select') state.setTool('select')
        else state.select([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  return (
    <div className="app">
      <TopBar
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((open) => !open)}
      />
      <Toolbar />
      <main className="stage">
        <h1 className="visually-hidden">SignalPlan editor</h1>
        <EditorCanvas coverage={broadcasting ? coverage : undefined} />
        {!broadcasting && (
          <p className="notice">
            No access point on this floor broadcasts on this band.
          </p>
        )}
        {error && <p className="notice">Couldn’t compute coverage: {error}</p>}
      </main>
      <PropertiesPanel open={panelOpen} />
      <StatusBar
        coverage={broadcasting ? coverage : undefined}
        saveStatus={saveStatus}
      />
      <Dialog
        open={problemOpen}
        title="Your saved plan couldn’t be opened"
        onClose={() => setProblemOpen(false)}
        actions={
          <>
            <button type="button" onClick={() => rescueSavedPlan()}>
              Download it
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setProblemOpen(false)}
            >
              Continue with the sample
            </button>
          </>
        }
      >
        <p>
          The sample home is open instead. Your next change will replace the
          saved plan, so download it first if you want to keep it.
        </p>
        <PlanIssues issues={savedPlanProblem ?? []} />
      </Dialog>
    </div>
  )
}

export default App
