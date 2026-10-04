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

/**
 * A modal dialog on the native <dialog> element: focus-trapped, Esc closes,
 * and focus returns to where it was when it opened (D23).
 */
export function Dialog({
  open,
  title,
  onClose,
  actions,
  children,
  wide = false,
}: {
  open: boolean
  title: string
  onClose: () => void
  actions: ReactNode
  children: ReactNode
  /** Twice as wide, for content laid out in columns. */
  wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // Where focus was before opening, to return it there on closing.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      element.showModal()
    }
    if (!open && element.open) element.close()
  }, [open])
  return (
    <dialog
      ref={dialog}
      className={wide ? 'dialog wide' : 'dialog'}
      aria-labelledby={titleId}
      onClose={() => {
        const target = opener.current
        opener.current = null
        // Unless something else has taken focus since, such as another dialog.
        const inside =
          document.activeElement === document.body ||
          dialog.current?.contains(document.activeElement)
        if (target?.isConnected && inside) target.focus()
        onClose()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="dialog-actions">{actions}</div>
    </dialog>
  )
}
