import type { ReactNode } from 'react'
import type { Autosaver, SaveProblem } from './autosave.ts'

/** What to tell someone whose changes aren't being saved (D91). */
const STORAGE_NOTICES: Record<NonNullable<SaveProblem>, string> = {
  full: 'Changes aren’t being saved: this browser’s storage is full. Use File › Save to file.',
  blocked:
    'Changes aren’t being saved: this browser is blocking storage. Use File › Save to file.',
  failed:
    'Couldn’t save your last changes in this browser. Use File › Save to file to keep a copy.',
}

/**
 * A steady line under the top bar while saving fails. It's a polite status
 * (not an alert) and never blocks editing; it appears once, when saving first
 * fails, and goes when a save works. A retry that fails again says so.
 * Other steady lines for the whole app (a new version, D98) go in `children`.
 */
export function StorageNotice({
  problem,
  retryFailed,
  autosaver,
  children,
}: {
  problem: SaveProblem
  retryFailed: boolean
  autosaver: Autosaver
  children?: ReactNode
}) {
  return (
    <div className="banner" role="status">
      {problem && (
        <p className="storage-notice">
          <span>
            {STORAGE_NOTICES[problem]}
            {retryFailed && ' Still couldn’t save.'}
          </span>
          {autosaver.canRetry && (
            <button type="button" onClick={() => void autosaver.retry()}>
              Try saving again
            </button>
          )}
        </p>
      )}
      {children}
    </div>
  )
}
