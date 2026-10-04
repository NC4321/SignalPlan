/** The raw reason for a failure, out of the way until asked for (D91). */
export function FailureDetails({ details }: { details: string }) {
  return (
    <details className="failure-details">
      <summary>Details</summary>
      <pre>{details}</pre>
    </details>
  )
}
