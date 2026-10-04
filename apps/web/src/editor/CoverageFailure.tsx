/**
 * Where the heatmap would be, when the worker that works it out has failed
 * (D91): what happened, what to try, and a button to try again. It sits over
 * the plan, so the plan itself stays usable.
 */
export function CoverageFailure({
  what,
  reason,
  onRetry,
}: {
  what: string
  reason: string
  onRetry: () => void
}) {
  return (
    <div className="notice coverage-failure" role="alert">
      <p>
        Couldn’t work out {what}: {reason.replace(/[.\s]+$/, '')}. Try again; if
        it keeps failing, reload the page. Your plan isn’t affected.
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
