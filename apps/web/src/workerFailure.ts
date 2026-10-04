/**
 * What a worker failing is called to someone using the app (D91). A worker
 * can throw (an `error` event with a message), send or receive something
 * that can't be copied (a `messageerror` event, with no message), or fail to
 * start at all (an error thrown by `new Worker`, or a script that won't load).
 * The raw reason is for a collapsed "Details", never the sentence itself.
 */
export function workerFailureText(failure?: unknown): string {
  const message =
    failure instanceof Error
      ? failure.message
      : typeof failure === 'object' &&
          failure !== null &&
          'message' in failure &&
          typeof failure.message === 'string'
        ? failure.message
        : ''
  // Browsers report an uncaught throw as "Uncaught Error: boom".
  return (
    message.replace(/^\s*Uncaught\s+(?:\w*Error:\s*)?/, '').trim() ||
    'the background calculation stopped unexpectedly'
  )
}

/**
 * Why a background job failed: `plan` when the worker answered with an error
 * (it depends on the plan, so trying again gives the same), `worker` when the
 * worker itself failed (trying again may work).
 */
export interface Failure {
  kind: 'plan' | 'worker'
  /** The raw reason, for "Details" and the console. */
  detail: string
}

/** A failure from the worker, also written to the console for a bug report. */
export function failure(kind: Failure['kind'], reason: unknown): Failure {
  const detail = typeof reason === 'string' ? reason : workerFailureText(reason)
  console.error('SignalPlan background job failed:', reason)
  return { kind, detail }
}

/** What to try, given what failed. */
export function advice(kind: Failure['kind']): string {
  return kind === 'plan'
    ? 'Undo your last change, or reload the page.'
    : 'Try again; if it keeps failing, reload the page.'
}
