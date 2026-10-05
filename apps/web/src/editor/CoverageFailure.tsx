import { advice, type Failure } from '../workerFailure.ts'
import { useEditor } from './context.ts'
import { FailureDetails } from './FailureDetails.tsx'

/**
 * Where the heatmap would be, when coverage couldn't be worked out (D91):
 * what happened, what to try, the raw reason in Details, and, when the worker
 * itself failed so trying again may work, a Try again button. It sits over
 * the plan, so the plan stays usable. With nothing to undo, as for a plan just
 * opened, it doesn't say to undo (D100).
 */
export function CoverageFailure({
  what,
  failure,
  onRetry,
}: {
  what: string
  failure: Failure
  onRetry: () => void
}) {
  const canUndo = useEditor((s) => s.past.length > 0)
  return (
    <div className="notice coverage-failure" role="alert">
      <p>
        Couldn’t work out coverage for {what}. {advice(failure.kind, canUndo)}
      </p>
      {failure.kind === 'worker' && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
      <FailureDetails details={failure.detail} />
    </div>
  )
}
