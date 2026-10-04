import type { Autosaver, SaveProblem } from './autosave.ts'

/** What to tell someone whose changes aren't being saved (D91). */
const STORAGE_NOTICES: Record<NonNullable<SaveProblem>, string> = {
  full: 'Your changes aren’t being saved in this browser: its storage is full. Use File › Save to file to keep a copy, or free some space. Saving starts again by itself once there’s room.',
  unavailable:
    'Your changes aren’t being saved in this browser: it’s blocking storage, as a private window often does. Use File › Save to file to keep a copy.',
}

/**
 * A steady line under the top bar while saving fails. It's a polite status
 * (not an alert) and never blocks editing; it appears once, when saving first
 * fails, and goes when a save works.
 */
export function StorageNotice({
  problem,
  autosaver,
}: {
  problem: SaveProblem
  autosaver: Autosaver
}) {
  return (
    <div className="banner" role="status">
      {problem && (
        <p className="storage-notice">
          <span>{STORAGE_NOTICES[problem]}</span>
          {autosaver.canRetry && (
            <button type="button" onClick={() => void autosaver.retry()}>
              Try saving again
            </button>
          )}
        </p>
      )}
    </div>
  )
}
