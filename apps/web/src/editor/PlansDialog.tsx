import type { PlanIssue } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import { useEditor, useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import type { PlanLibrary, PlanSummary } from './library.ts'
import { downloadPlan, rescuePlan, samplePlan } from './persistence.ts'
import { useServices } from './services.ts'
import { embedImages } from './tracing.ts'
import { editedAgo } from './util.ts'

const TRY =
  'Reload the page and try again, or save the open plan to a file first.'
const LIST_FAILED = `The list of plans couldn’t be read from this browser. ${TRY}`

/**
 * The plans kept in this browser (D21): open, rename, duplicate or delete
 * them. Deleting asks first, with a chance to download a copy.
 */
export function PlansDialog({
  open,
  library,
  onClose,
}: {
  open: boolean
  library: PlanLibrary
  onClose: () => void
}) {
  const store = useEditorStore()
  const { autosaver } = useServices()
  const currentId = useEditor((s) => s.planId)
  const [plans, setPlans] = useState<PlanSummary[]>()
  const [renaming, setRenaming] = useState<{ id: string; name: string }>()
  const [deleting, setDeleting] = useState<PlanSummary>()
  const [broken, setBroken] = useState<{
    name: string
    issues: PlanIssue[]
    raw: unknown
  }>()

  /** Set when the list or a plan couldn't be read from this browser. */
  const [failure, setFailure] = useState<string>()

  const close = () => {
    setFailure(undefined)
    onClose()
  }

  const refresh = async () => {
    try {
      await autosaver.flush()
      setPlans(await library.list())
    } catch {
      setFailure(LIST_FAILED)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        await autosaver.flush()
        const list = await library.list()
        if (!cancelled) setPlans(list)
      } catch {
        if (!cancelled) setFailure(LIST_FAILED)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, library, autosaver])

  const openPlan = async (summary: PlanSummary) => {
    setFailure(undefined)
    try {
      await autosaver.flush()
      const opened = await library.open(summary.id)
      if (opened.kind === 'plan') {
        store.getState().loadPlan(opened.plan, { id: summary.id })
        await library.setLastPlanId(summary.id)
        close()
      } else if (opened.kind === 'invalid') {
        setBroken({
          name: summary.name,
          issues: opened.issues,
          raw: opened.raw,
        })
      } else {
        // Gone since the list was drawn, say deleted in another tab.
        await refresh()
        setFailure(`“${summary.name}” is no longer in this browser.`)
      }
    } catch {
      setFailure(`“${summary.name}” couldn’t be read from this browser. ${TRY}`)
    }
  }

  const rename = async (id: string, name: string) => {
    setRenaming(undefined)
    if (id === currentId) store.getState().renamePlan(name)
    else await library.rename(id, name)
    await refresh()
  }

  const remove = async (summary: PlanSummary) => {
    setDeleting(undefined)
    await library.remove(summary.id)
    if (summary.id === currentId) {
      // Open the next most recent plan, or the sample if none are left.
      const [next] = await library.list()
      const opened = next ? await library.open(next.id) : undefined
      if (next && opened?.kind === 'plan') {
        store.getState().loadPlan(opened.plan, { id: next.id })
        await library.setLastPlanId(next.id)
      } else {
        store.getState().loadPlan(samplePlan(), { pristine: true })
      }
    }
    await refresh()
  }

  const downloadCopy = async (id: string) => {
    const opened = await library.open(id)
    if (opened.kind === 'plan')
      downloadPlan(await embedImages(opened.plan, library))
    else if (opened.kind === 'invalid') rescuePlan(opened.raw)
  }

  return (
    <>
      <Dialog
        open={open}
        title="My plans"
        onClose={close}
        actions={
          <button type="button" className="primary" onClick={close}>
            Done
          </button>
        }
      >
        <p className="hint">
          Plans are kept in this browser only. Save to a file to back one up or
          share it.
        </p>
        {failure && (
          <p role="alert" className="field-error">
            {failure}
          </p>
        )}
        {plans === undefined ? (
          failure ? null : (
            <p role="status">Loading…</p>
          )
        ) : plans.length === 0 ? (
          <p>No plans yet. Any plan you change is added here automatically.</p>
        ) : (
          <ul className="plan-list">
            {plans.map((plan) => (
              <li
                key={plan.id}
                aria-current={plan.id === currentId || undefined}
              >
                {renaming?.id === plan.id ? (
                  <input
                    aria-label={`New name for ${plan.name}`}
                    value={renaming.name}
                    autoFocus
                    maxLength={200}
                    onChange={(event) =>
                      setRenaming({ id: plan.id, name: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void rename(plan.id, renaming.name)
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setRenaming(undefined)
                      }
                    }}
                    onBlur={() => void rename(plan.id, renaming.name)}
                  />
                ) : (
                  <div className="plan-name-cell">
                    <strong>{plan.name}</strong>
                    <span>
                      {plan.id === currentId ? 'Open now · ' : ''}Edited{' '}
                      {editedAgo(plan.updatedAt)}
                    </span>
                  </div>
                )}
                <div className="plan-actions">
                  <button
                    type="button"
                    disabled={plan.id === currentId}
                    onClick={() => void openPlan(plan)}
                    aria-label={`Open ${plan.name}`}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRenaming({ id: plan.id, name: plan.name })
                    }
                    aria-label={`Rename ${plan.name}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await autosaver.flush()
                      await library.duplicate(plan.id)
                      await refresh()
                    }}
                    aria-label={`Duplicate ${plan.name}`}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setDeleting(plan)}
                    aria-label={`Delete ${plan.name}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={deleting !== undefined}
        title={`Delete “${deleting?.name ?? ''}”?`}
        onClose={() => setDeleting(undefined)}
        actions={
          <>
            <button type="button" onClick={() => setDeleting(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleting && void downloadCopy(deleting.id)}
            >
              Download a copy first
            </button>
            <button
              type="button"
              className="primary danger-fill"
              onClick={() => deleting && void remove(deleting)}
            >
              Delete
            </button>
          </>
        }
      >
        <p>This can’t be undone.</p>
      </Dialog>

      <Dialog
        open={broken !== undefined}
        title={`“${broken?.name ?? ''}” can’t be opened`}
        onClose={() => setBroken(undefined)}
        actions={
          <>
            <button type="button" onClick={() => rescuePlan(broken?.raw)}>
              Download it
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setBroken(undefined)}
            >
              OK
            </button>
          </>
        }
      >
        <p>
          This plan is kept in this browser but doesn’t pass the checks, so it
          wasn’t opened. Your open plan is unchanged.
        </p>
        <PlanIssues issues={broken?.issues ?? []} />
        <p className="hint">
          Download it to keep what’s in it. A plan from a newer SignalPlan needs
          this page reloaded to the latest version.
        </p>
      </Dialog>
    </>
  )
}
