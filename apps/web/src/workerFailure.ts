/**
 * What a worker failing is called to someone using the app (D91). A worker
 * can throw (an `error` event with a message), send or receive something
 * that can't be copied (a `messageerror` event, with no message), or fail to
 * start at all (an error thrown by `new Worker`).
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
