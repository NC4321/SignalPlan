import { withChannelPlan } from './editor/channelPlan.ts'
import { View3DHost } from './view3d/View3DHost.tsx'
import { viewSettings } from '@signalplan/engine'
import { mapData } from './mapView.ts'
import { adjacentFloorId, type PlanIssue } from '@signalplan/floorplan'
import { useEffect, useMemo, useState } from 'react'
import { useEditor, useEditorStore } from './editor/context.ts'
import { EditorCanvas } from './editor/EditorCanvas.tsx'
import { FloorStack } from './editor/FloorStack.tsx'
import { useSaveStatus } from './editor/autosave.ts'
import { CalibrationBar } from './editor/CalibrationBar.tsx'
import { ScanPlacementBar, ScanProvider } from './editor/ScanProvider.tsx'
import { SurveyImportProvider } from './editor/SurveyImportProvider.tsx'
import { TracingProvider } from './editor/TracingProvider.tsx'
import { Dialog, PlanIssues } from './editor/Dialog.tsx'
import { SharedLinkOpener } from './editor/SharedLinkOpener.tsx'
import { Guide } from './editor/Guide.tsx'
import { rescuePlan } from './editor/persistence.ts'
import { useServices } from './editor/services.ts'
import {
  PropertiesPanel,
  StatusBar,
  TopBar,
  Toolbar,
} from './editor/panels.tsx'
import { useCoverageMessage } from './editor/useCoverageMessage.ts'
import {
  deleteRecipe,
  describeSelection,
  onlySurveySpots,
} from './editor/selectTool.ts'
import { isTyping } from './editor/util.ts'
import { toolForKey } from './editor/shortcuts.ts'
import {
  createOptimizer,
  withSuggestion,
  type SearchWorker,
} from './editor/optimizer.ts'
import { OptimizerContext } from './editor/optimizerContext.ts'
import {
  createModelCalibrator,
  withModelCalibration,
  type CalibrationWorker,
} from './editor/modelCalibration.ts'
import { CalibratorContext } from './editor/calibratorContext.ts'
import { useCoverage } from './useCoverage.ts'
import { useFloorsCoverage } from './useFloorsCoverage.ts'
import { DEFAULT_TARGET } from './quality.ts'

function App({
  savedPlanProblem,
  linkIssues,
}: {
  /** Set when the last plan in this browser could not be opened. */
  savedPlanProblem?: { issues: readonly PlanIssue[]; raw: unknown } | undefined
  /** Set when the plan link SignalPlan was opened with couldn't be read. */
  linkIssues?: PlanIssue[] | undefined
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
  const calibrator = useMemo(
    () =>
      createModelCalibrator(
        store,
        () =>
          new Worker(new URL('./calibration.worker.ts', import.meta.url), {
            type: 'module',
          }) as CalibrationWorker,
      ),
    [store],
  )
  useEffect(() => calibrator.dispose, [calibrator])

  // While a suggestion waits, the heatmap shows the plan with it applied;
  // the same goes for a channel plan (D68) and a calibration (D76).
  const channelPlan = useEditor((s) => s.channelPlan)
  const modelCalibration = useEditor((s) => s.modelCalibration)
  const shownPlan = useMemo(() => {
    const placed = suggestion ? withSuggestion(plan, suggestion) : plan
    const planned = channelPlan ? withChannelPlan(placed, channelPlan) : placed
    return withModelCalibration(planned, modelCalibration)
  }, [plan, suggestion, channelPlan, modelCalibration])
  const calibrating = shownPlan.calibration !== plan.calibration
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
  const view = useEditor((s) => s.view)
  const view3d = useEditor((s) => s.view3d)
  const showHeatmap = useEditor((s) => s.showHeatmap)
  const units = useEditor((s) => s.units)
  const floorsCoverage = useFloorsCoverage(shownPlan, band, view === '3d')
  const shown = broadcasting ? coverage : undefined
  // What the heatmap shows, worked out from the coverage (D64).
  const show = useEditor((s) => s.show)
  const { overlapMarginDb, roamThresholdDbm } = viewSettings(shownPlan)
  const settings = useMemo(
    () => ({ overlapMarginDb, roamThresholdDbm }),
    [overlapMarginDb, roamThresholdDbm],
  )
  const map = useMemo(
    () => (shown ? mapData(shown, show, settings, shownPlan) : undefined),
    [shown, show, settings, shownPlan],
  )
  const floorMaps = useMemo(
    () =>
      new Map(
        [...floorsCoverage].map(([id, c]) => [
          id,
          mapData(c, show, settings, shownPlan),
        ]),
      ),
    [floorsCoverage, show, settings, shownPlan],
  )
  const summary = useCoverageMessage(map)
  const coverageText = !summary
    ? summary
    : suggestion
      ? `With the suggestion: ${summary}`
      : calibrating
        ? `With the calibration: ${summary}`
        : summary

  // Global shortcuts: undo, redo and tools.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const state = store.getState()
      const picked = toolForKey(key)
      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
      } else if (mod && key === 'y') {
        event.preventDefault()
        state.redo()
      } else if (
        state.view === '3d' &&
        !mod &&
        (picked || key === 'delete' || key === 'backspace')
      ) {
        // The 3D view is for looking: tools and deleting are in 2D (D57).
        return
      } else if (!mod && !event.altKey && picked) {
        state.setTool(picked)
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
          { keepOptimizer: onlySurveySpots(state.selection) },
        )
      } else if (key === 'escape') {
        // Esc finishes the chain; pressed again, it returns to Select (D16).
        // It also stops a search or dismisses a suggestion (D44), and drops a
        // floor opening being drawn (D54), or a scan waiting to be placed
        // (D82).
        if (state.placeScan) {
          state.setPlaceScan(undefined)
          state.setNotice('Scan not imported.')
        } else if (state.chain) state.endChain()
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
  const placingScan = useEditor((s) => s.placeScan !== undefined)

  return (
    <TracingProvider>
      <SurveyImportProvider>
        <ScanProvider>
          <OptimizerContext value={optimizer}>
            <CalibratorContext value={calibrator}>
              <div className="app">
                <TopBar
                  panelOpen={panelOpen}
                  onTogglePanel={() => setPanelOpen((open) => !open)}
                />
                <Toolbar />
                <main className="stage">
                  <h1 className="visually-hidden">SignalPlan editor</h1>
                  {view === '3d' ? (
                    <View3DHost
                      plan={shownPlan}
                      maps={floorMaps}
                      hiddenFloors={view3d.hiddenFloors}
                      spreadM={view3d.spreadM}
                      fullWalls={view3d.fullWalls}
                      showHeatmap={showHeatmap}
                      units={units}
                      target={plan.coverageTarget ?? DEFAULT_TARGET}
                    />
                  ) : (
                    <>
                      <EditorCanvas coverage={shown} map={map} />
                      {tool === 'calibrate' && <CalibrationBar />}
                      {placingScan && <ScanPlacementBar />}
                      <FloorStack />
                    </>
                  )}
                  {view === '2d' && !broadcastingHere && (
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
                  <Guide />
                </main>
                <PropertiesPanel
                  open={panelOpen}
                  coverageText={coverageText}
                  map={map}
                />
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
                    The sample home is open instead. The plan is still in My
                    plans; download it to keep a copy of what was stored.
                  </p>
                  <PlanIssues issues={savedPlanProblem?.issues ?? []} />
                </Dialog>
                <SharedLinkOpener startupIssues={linkIssues} />
              </div>
            </CalibratorContext>
          </OptimizerContext>
        </ScanProvider>
      </SurveyImportProvider>
    </TracingProvider>
  )
}

export default App
