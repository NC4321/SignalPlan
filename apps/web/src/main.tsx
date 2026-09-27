import { parsePlan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { EditorContext } from './editor/context.ts'
import { createEditorStore } from './editor/store.ts'
import './index.css'

const sample = parsePlan(sampleHome)
if (!sample.ok) {
  throw new Error(`Sample plan is invalid: ${sample.issues[0]?.message}`)
}
const store = createEditorStore(sample.plan)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorContext value={store}>
      <App />
    </EditorContext>
  </StrictMode>,
)
