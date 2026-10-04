import type { Plan, PlanIssue } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import { useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import { downloadPlan } from './persistence.ts'
import { useServices } from './services.ts'
import {
  clearShareFragment,
  isShareFragment,
  planFromFragment,
} from './shareLink.ts'
import { embedImages } from './tracing.ts'

/**
 * Opens a plan link pasted into a tab that already has SignalPlan open
 * (the page doesn't reload when only the fragment changes), and explains a
 * link that can't be opened, at start-up or later (D88). The plan opens
 * like the sample: it joins My plans on its first edit.
 *
 * If the open plan couldn't be saved first (storage full or blocked), the
 * link waits for the person to save it to a file or open the link anyway,
 * so a browser that never saves can't block links for good (D93).
 */
export function SharedLinkOpener({
  startupIssues,
}: {
  /** Set when the link SignalPlan was opened with couldn't be read. */
  startupIssues?: PlanIssue[] | undefined
}) {
  const store = useEditorStore()
  const { autosaver, library } = useServices()
  const [issues, setIssues] = useState(startupIssues)
  /** A link's plan, held while the open plan isn't safely kept. */
  const [waiting, setWaiting] = useState<Plan>()
  useEffect(() => {
    const onHashChange = async () => {
      if (!isShareFragment(window.location.hash)) return
      const result = await planFromFragment(window.location.hash)
      clearShareFragment(window.location, window.history)
      if (!result.ok) {
        setIssues(result.issues)
        return
      }
      await autosaver.flush()
      const status = autosaver.getStatus()
      const unsaved =
        !store.getState().pristine &&
        (!library || status === 'full' || status === 'unavailable')
      if (unsaved) setWaiting(result.plan)
      else store.getState().loadPlan(result.plan, { pristine: true })
    }
    const listener = () => void onHashChange()
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [store, autosaver, library])

  const openAnyway = () => {
    if (waiting) store.getState().loadPlan(waiting, { pristine: true })
    setWaiting(undefined)
  }

  return (
    <>
      <Dialog
        open={issues !== undefined}
        title="This link can’t be opened"
        onClose={() => setIssues(undefined)}
        actions={
          <button
            type="button"
            className="primary"
            onClick={() => setIssues(undefined)}
          >
            OK
          </button>
        }
      >
        <p>The plan that was open stays open. The link has problems:</p>
        <PlanIssues issues={issues ?? []} />
      </Dialog>
      <Dialog
        open={waiting !== undefined}
        title="Your open plan isn’t saved"
        onClose={() => setWaiting(undefined)}
        actions={
          <>
            <button type="button" onClick={() => setWaiting(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={async () =>
                downloadPlan(await embedImages(store.getState().plan, library))
              }
            >
              Save to file
            </button>
            <button type="button" className="primary" onClick={openAnyway}>
              Open the link anyway
            </button>
          </>
        }
      >
        <p>
          This browser couldn’t keep a copy of the plan that’s open, and the
          link would replace it. Save it to a file first, or open the link
          anyway and lose its latest changes.
        </p>
      </Dialog>
    </>
  )
}
