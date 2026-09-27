import type { PlanIssue } from '@signalplan/floorplan'
import { useEffect, useState } from 'react'
import { useEditor, useEditorStore } from './context.ts'
import { Dialog, PlanIssues } from './Dialog.tsx'
import type { PlanLibrary, PlanSummary } from './library.ts'
import { downloadPlan, rescuePlan, samplePlan } from './persistence.ts'
import { useServices } from './services.ts'
import { editedAgo } from './util.ts'

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

  const refresh = async () => {
    await autosaver.flush()
    setPlans(await library.list())
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      await autosaver.flush()
      const list = await library.list()
      if (!cancelled) setPlans(list)
    })()
    return () => {
      cancelled = true
    }
  }, [open, library, autosaver])

  const openPlan = async (summary: PlanSummary) => {
    await autosaver.flush()
    const opened = await library.open(summary.id)
    if (opened.kind === 'plan') {
      store.getState().loadPlan(opened.plan, { id: summary.id })
      await library.setLastPlanId(summary.id)
      onClose()
    } else if (opened.kind === 'invalid') {
      setBroken({ name: summary.name, issues: opened.issues, raw: opened.raw })
    } else {
      await refresh()
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
    if (opened.kind === 'plan') downloadPlan(opened.plan)
    else if (opened.kind === 'invalid') rescuePlan(opened.raw)
  }

  return (
    <>
      <Dialog
        open={open}
        title="My plans"
        onClose={onClose}
        actions={
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <p className="hint">
          Plans are kept in this browser only. Save to a file to back one up or
          share it.
        </p>
        {plans === undefined ? (
          <p>Loading…</p>
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
        <PlanIssues issues={broken?.issues ?? []} />
      </Dialog>
    </>
  )
}
