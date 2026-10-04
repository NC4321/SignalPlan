import type { Plan, PlanIssue } from '@signalplan/floorplan'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { Autosaver } from './editor/autosave.ts'
import { EditorContext } from './editor/context.ts'
import { imageIdsIn, PlanLibrary } from './editor/library.ts'
import { readUnits, safeStorage, samplePlan } from './editor/persistence.ts'
import { ServicesContext } from './editor/services.ts'
import {
  clearShareFragment,
  isShareFragment,
  planFromFragment,
} from './editor/shareLink.ts'
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

// A plan link opens its plan like the sample: it joins My plans on its first
// edit, and the last plan stays in the list (D88).
let shared: Plan | undefined
let linkIssues: PlanIssue[] | undefined
if (isShareFragment(window.location.hash)) {
  const result = await planFromFragment(window.location.hash)
  if (result.ok) shared = result.plan
  else linkIssues = result.issues
  clearShareFragment(window.location, window.history)
}

const store = shared
  ? createEditorStore(shared, { units: readUnits(), pristine: true })
  : last?.kind === 'plan'
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
        <App
          savedPlanProblem={shared ? undefined : problem}
          linkIssues={linkIssues}
        />
      </ServicesContext>
    </EditorContext>
  </StrictMode>,
)
