import type { PlanIssue } from '@signalplan/floorplan'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { Autosaver } from './editor/autosave.ts'
import { EditorContext } from './editor/context.ts'
import { imageIdsIn, PlanLibrary } from './editor/library.ts'
import { readUnits, safeStorage, samplePlan } from './editor/persistence.ts'
import { ServicesContext } from './editor/services.ts'
import { createEditorStore } from './editor/store.ts'
import './index.css'

// Reopen the last plan edited in this browser; the sample home is for a first
// visit (D21). A stored plan that no longer loads falls back to the sample.
const library = await PlanLibrary.open()
await library?.migrateFrom(safeStorage())
const lastId = await library?.lastPlanId()
const last = lastId ? await library?.open(lastId) : undefined

let problem: { issues: PlanIssue[]; raw: unknown } | undefined
if (last?.kind === 'invalid') problem = { issues: last.issues, raw: last.raw }

const store =
  last?.kind === 'plan'
    ? createEditorStore(last.plan, {
        units: readUnits(),
        pristine: false,
        ...(lastId ? { id: lastId } : {}),
      })
    : createEditorStore(samplePlan(), { units: readUnits(), pristine: true })
const autosaver = new Autosaver(store, library)
autosaver.start()
// Tidy away tracing images that no saved plan uses any more.
void library?.collectGarbage(imageIdsIn(store.getState().plan))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorContext value={store}>
      <ServicesContext value={{ library, autosaver }}>
        <App savedPlanProblem={problem} />
      </ServicesContext>
    </EditorContext>
  </StrictMode>,
)
