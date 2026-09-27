import { loadPlan, type Plan, type PlanIssue } from '@signalplan/floorplan'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useEditor, useEditorStore } from './context.ts'
import {
  blankPlan,
  downloadPlan,
  FILE_EXTENSION,
  samplePlan,
} from './persistence.ts'
import { isTyping, MOD_KEY } from './util.ts'

type Pending = { label: string; plan: Plan; pristine: boolean }

/**
 * New, Open, Save and the sample home. Replacing a plan that has been edited
 * asks first, offering to download a copy, since only one plan is kept in the
 * browser (D20).
 */
export function FileMenu() {
  const store = useEditorStore()
  const menu = useRef<HTMLDetailsElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending>()
  const [problem, setProblem] = useState<{
    file: string
    issues: PlanIssue[]
  }>()
  const planName = useEditor((s) => s.plan.name)

  const closeMenu = () => menu.current?.removeAttribute('open')

  const replaceWith = (next: Pending) => {
    closeMenu()
    if (store.getState().pristine) {
      store.getState().loadPlan(next.plan, next.pristine)
    } else {
      setPending(next)
    }
  }

  const openFile = async (file: File) => {
    const result = loadPlan(await file.text())
    if (!result.ok) {
      setProblem({ file: file.name, issues: result.issues })
      return
    }
    replaceWith({
      label: `Open “${file.name}”`,
      plan: result.plan,
      pristine: false,
    })
  }

  // Ctrl/⌘+S saves to a file, Ctrl/⌘+O opens one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (isTyping(event) && event.key.toLowerCase() !== 's') return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        downloadPlan(store.getState().plan)
      } else if (key === 'o') {
        event.preventDefault()
        fileInput.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  return (
    <>
      <details className="menu" ref={menu}>
        <summary>File</summary>
        <div className="menu-items">
          <button
            type="button"
            onClick={() =>
              replaceWith({
                label: 'Start a new plan',
                plan: blankPlan(),
                pristine: true,
              })
            }
          >
            New plan
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              fileInput.current?.click()
            }}
          >
            Open file… <kbd>{MOD_KEY}O</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              closeMenu()
              downloadPlan(store.getState().plan)
            }}
          >
            Save to file <kbd>{MOD_KEY}S</kbd>
          </button>
          <button
            type="button"
            onClick={() =>
              replaceWith({
                label: 'Open the sample home',
                plan: samplePlan(),
                pristine: true,
              })
            }
          >
            Open the sample home
          </button>
        </div>
      </details>

      <input
        ref={fileInput}
        type="file"
        accept={`${FILE_EXTENSION},.json,application/json`}
        hidden
        aria-label="Open a plan file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void openFile(file)
        }}
      />

      <Dialog
        open={pending !== undefined}
        title="Replace your current plan?"
        onClose={() => setPending(undefined)}
        actions={
          <>
            <button type="button" onClick={() => setPending(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => downloadPlan(store.getState().plan)}
            >
              Download a copy first
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (pending)
                  store.getState().loadPlan(pending.plan, pending.pristine)
                setPending(undefined)
              }}
            >
              {pending?.label ?? 'Replace'}
            </button>
          </>
        }
      >
        <p>
          Only one plan is kept in this browser. “{planName}” will be replaced;
          download a copy first if you want to keep it.
        </p>
      </Dialog>

      <Dialog
        open={problem !== undefined}
        title="This file can’t be opened"
        onClose={() => setProblem(undefined)}
        actions={
          <button
            type="button"
            className="primary"
            onClick={() => setProblem(undefined)}
          >
            OK
          </button>
        }
      >
        <p>“{problem?.file}” isn’t a SignalPlan plan, or it has problems:</p>
        <PlanIssues issues={problem?.issues ?? []} />
      </Dialog>
    </>
  )
}

/** The first few problems with a plan, with where they are. */
export function PlanIssues({ issues }: { issues: readonly PlanIssue[] }) {
  const shown = issues.slice(0, 5)
  return (
    <ul className="issues">
      {shown.map((issue, i) => (
        <li key={i}>
          {issue.path && <code>{issue.path}</code>} {issue.message}
        </li>
      ))}
      {issues.length > shown.length && (
        <li>…and {issues.length - shown.length} more.</li>
      )}
    </ul>
  )
}

/** A modal dialog on the native <dialog> element: focus-trapped, Esc closes. */
export function Dialog({
  open,
  title,
  onClose,
  actions,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  actions: ReactNode
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])
  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="dialog-actions">{actions}</div>
    </dialog>
  )
}
