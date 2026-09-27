import { useEffect, useState } from 'react'
import { useEditor, useEditorStore } from './editor/context.ts'
import { EditorCanvas } from './editor/EditorCanvas.tsx'
import {
  PropertiesPanel,
  StatusBar,
  TopBar,
  Toolbar,
} from './editor/panels.tsx'
import { deleteRecipe, describeSelection } from './editor/selectTool.ts'
import { isTyping } from './editor/util.ts'
import { useCoverage } from './useCoverage.ts'

function App() {
  const store = useEditorStore()
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
        else if (state.tool === 'wall') state.setTool('select')
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
      <StatusBar coverage={broadcasting ? coverage : undefined} />
    </div>
  )
}

export default App
