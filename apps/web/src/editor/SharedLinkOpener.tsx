import type { PlanIssue } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import { useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import { useServices } from './services.ts'
import {
  clearShareFragment,
  isShareFragment,
  planFromFragment,
} from './shareLink.ts'

/**
 * Opens a plan link pasted into a tab that already has SignalPlan open
 * (the page doesn't reload when only the fragment changes), and explains a
 * link that can't be opened, at start-up or later (D88). The plan opens
 * like the sample: it joins My plans on its first edit.
 */
export function SharedLinkOpener({
  startupIssues,
}: {
  /** Set when the link SignalPlan was opened with couldn't be read. */
  startupIssues?: PlanIssue[] | undefined
}) {
  const store = useEditorStore()
  const { autosaver } = useServices()
  const [issues, setIssues] = useState(startupIssues)
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
      store.getState().loadPlan(result.plan, { pristine: true })
    }
    const listener = () => void onHashChange()
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [store, autosaver])
  return (
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
  )
}
