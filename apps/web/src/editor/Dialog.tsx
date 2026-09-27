import type { PlanIssue } from '@signalplan/floorplan'
import { useEffect, useId, useRef, type ReactNode } from 'react'

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
