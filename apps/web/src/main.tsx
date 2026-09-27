import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { EditorContext } from './editor/context.ts'
import { readSavedPlan, readUnits, samplePlan } from './editor/persistence.ts'
import { createEditorStore } from './editor/store.ts'
import './index.css'

// Reopen the plan saved in this browser; the sample home is for a first visit
// (D20). A saved plan that no longer loads falls back to the sample.
const saved = readSavedPlan()
const store = createEditorStore(
  saved.kind === 'plan' ? saved.plan : samplePlan(),
  { units: readUnits(), pristine: saved.kind !== 'plan' },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorContext value={store}>
      <App
        savedPlanProblem={saved.kind === 'invalid' ? saved.issues : undefined}
      />
    </EditorContext>
  </StrictMode>,
)
