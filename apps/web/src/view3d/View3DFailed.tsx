import { useEditorStore } from '../editor/context.ts'
import {
  VIEW3D_FAILURES,
  VIEW3D_LOADING,
  type View3DFailure,
} from './failures.ts'

/** What the 3D view's area shows while it loads. */
export function View3DLoading() {
  return (
    <div className="view3d view3d-failed" role="status">
      <p>{VIEW3D_LOADING}</p>
    </div>
  )
}

/**
 * What the 3D view's area shows when it can't draw: what happened, what to
 * try, and a way back to the 2D view (D93).
 */
export function View3DFailed({
  failure,
  onRetry,
}: {
  failure: View3DFailure
  onRetry: () => void
}) {
  const store = useEditorStore()
  const { message, canRetry, reload } = VIEW3D_FAILURES[failure]
  return (
    <div className="view3d view3d-failed" role="alert">
      <div className="view3d-failed-box">
        <p>{message}</p>
        <div className="actions">
          {canRetry && (
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          )}
          {reload && (
            <button type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => store.getState().setView('2d')}
          >
            Back to the 2D view
          </button>
        </div>
      </div>
    </div>
  )
}
