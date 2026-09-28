import { adjacentFloorId, type PlanIssue } from '@signalplan/floorplan'
import { useEffect, useMemo, useState } from 'react'
import { useEditor, useEditorStore } from './editor/context.ts'
import { EditorCanvas } from './editor/EditorCanvas.tsx'
import { FloorStack } from './editor/FloorStack.tsx'
import { useSaveStatus } from './editor/autosave.ts'
import { CalibrationBar } from './editor/CalibrationBar.tsx'
import { TracingProvider } from './editor/TracingProvider.tsx'
import { Dialog, PlanIssues } from './editor/Dialog.tsx'
import { rescuePlan } from './editor/persistence.ts'
import { useServices } from './editor/services.ts'
import {
  PropertiesPanel,
  StatusBar,
  TopBar,
  Toolbar,
} from './editor/panels.tsx'
import { useCoverageMessage } from './editor/useCoverageMessage.ts'
import { deleteRecipe, describeSelection } from './editor/selectTool.ts'
import { isTyping } from './editor/util.ts'
import {
  createOptimizer,
  withSuggestion,
  type SearchWorker,
} from './editor/optimizer.ts'
import { OptimizerContext } from './editor/optimizerContext.ts'
import { useCoverage } from './useCoverage.ts'

function App({
  savedPlanProblem,
}: {
  /** Set when the last plan in this browser could not be opened. */
  savedPlanProblem?: { issues: readonly PlanIssue[]; raw: unknown } | undefined
}) {
  const store = useEditorStore()
  const { autosaver } = useServices()
  const saveStatus = useSaveStatus(autosaver)
  const [problemOpen, setProblemOpen] = useState(savedPlanProblem !== undefined)
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const band = useEditor((s) => s.band)
  const [panelOpen, setPanelOpen] = useState(false)
  const optimizerState = useEditor((s) => s.optimizer)
  const suggestion =
    optimizerState?.status === 'suggestion'
      ? optimizerState.suggestion
      : undefined

  const optimizer = useMemo(
    () =>
      createOptimizer(
        store,
        () =>
          new Worker(new URL('./placement.worker.ts', import.meta.url), {
            type: 'module',
          }) as SearchWorker,
      ),
    [store],
  )
  useEffect(() => optimizer.dispose, [optimizer])

  // While a suggestion waits, the heatmap shows the plan with it applied.
  const shownPlan = useMemo(
    () => (suggestion ? withSuggestion(plan, suggestion) : plan),
    [plan, suggestion],
  )
  const hasAccessPoint = shownPlan.accessPoints.some(
    (ap) => ap.floorId === floorId,
  )
  const onBand = shownPlan.accessPoints.filter((ap) =>
    ap.radios.some((radio) => radio.band === band),
  )
  // Signal from other floors counts too (D51, D52).
  const broadcasting = onBand.length > 0
  const broadcastingHere = onBand.some((ap) => ap.floorId === floorId)
  const { coverage, error } = useCoverage(shownPlan, floorId, band)
  const shown = broadcasting ? coverage : undefined
  const summary = useCoverageMessage(shown)
  const coverageText =
    suggestion && summary ? `With the suggestion: ${summary}` : summary

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
      } else if (!mod && !event.altKey && key === 'o') {
        state.setTool('floorOpening')
      } else if (!mod && !event.altKey && key === 'a') {
        state.setTool('accessPoint')
      } else if (
        (event.key === 'PageUp' || event.key === 'PageDown') &&
        !mod &&
        !state.gesture
      ) {
        // Up and down the floor stack (D52).
        const next = adjacentFloorId(
          state.plan.floors,
          state.floorId,
          event.key === 'PageUp' ? 1 : -1,
        )
        event.preventDefault()
        if (next) state.setFloor(next)
      } else if (key === 'enter' && state.chain) {
        state.endChain()
      } else if (key === 'enter' && state.outline) {
        state.finishOutline()
      } else if (key === 'delete' || key === 'backspace') {
        if (state.selection.length === 0) return
        event.preventDefault()
        state.edit(
          `Delete ${describeSelection(state.selection)}`,
          deleteRecipe(state.floorId, state.selection),
        )
      } else if (key === 'escape') {
        // Esc finishes the chain; pressed again, it returns to Select (D16).
        // It also stops a search or dismisses a suggestion (D44), and drops a
        // floor opening being drawn (D54).
        if (state.chain) state.endChain()
        else if (state.outline) state.cancelOutline()
        else if (state.optimizer) state.setOptimizer(undefined)
        else if (state.tool !== 'select') state.setTool('select')
        else state.select([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  const tool = useEditor((s) => s.tool)

  return (
    <TracingProvider>
      <OptimizerContext value={optimizer}>
        <div className="app">
          <TopBar
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((open) => !open)}
          />
          <Toolbar />
          <main className="stage">
            <h1 className="visually-hidden">SignalPlan editor</h1>
            <EditorCanvas coverage={shown} />
            {tool === 'calibrate' && <CalibrationBar />}
            <FloorStack />
            {!broadcastingHere && (
              <p className="notice">
                {(hasAccessPoint
                  ? 'No access point on this floor broadcasts on this band.'
                  : 'No access points on this floor.') +
                  (broadcasting
                    ? ' The heatmap shows signal from other floors.'
                    : hasAccessPoint
                      ? ' Select one and turn the band on under Bands.'
                      : ' Add one with the Access point tool.')}
              </p>
            )}
            {error && (
              <p className="notice">Couldn’t compute coverage: {error}</p>
            )}
          </main>
          <PropertiesPanel open={panelOpen} coverageText={coverageText} />
          <StatusBar
            coverage={shown}
            coverageText={coverageText}
            saveStatus={saveStatus}
          />
          <Dialog
            open={problemOpen}
            title="Your saved plan couldn’t be opened"
            onClose={() => setProblemOpen(false)}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => rescuePlan(savedPlanProblem?.raw)}
                >
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
              The sample home is open instead. The plan is still in My plans;
              download it to keep a copy of what was stored.
            </p>
            <PlanIssues issues={savedPlanProblem?.issues ?? []} />
          </Dialog>
        </div>
      </OptimizerContext>
    </TracingProvider>
  )
}

export default App
