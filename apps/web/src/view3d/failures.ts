/** Why the 3D view can't be shown, and what to say about it (D93). */
export type View3DFailure =
  'no-webgl' | 'no-context' | 'lost' | 'broken' | 'not-loaded'

const MAP = 'use the 2D map, which shows the same coverage'

export const VIEW3D_LOADING = 'Loading the 3D view…'

export const VIEW3D_FAILURES: Record<
  View3DFailure,
  { message: string; canRetry: boolean; reload?: boolean }
> = {
  'no-webgl': {
    message: `The 3D view needs WebGL, which this browser has turned off or doesn’t support. Turn on hardware acceleration in its settings, or ${MAP}.`,
    canRetry: false,
  },
  'no-context': {
    message: `The browser wouldn’t start the 3D view, often because many tabs are using the graphics card. Close some and try again, or ${MAP}.`,
    canRetry: true,
  },
  lost: {
    message: `The graphics card stopped drawing the 3D view. Try again, or ${MAP}.`,
    canRetry: true,
  },
  // A failed import is remembered by the browser until the page reloads.
  'not-loaded': {
    message: `The 3D view’s code couldn’t be loaded, usually because the connection dropped. Reload the page once it’s back, or ${MAP}.`,
    canRetry: false,
    reload: true,
  },
  broken: {
    message: `Something went wrong drawing the 3D view. Try again, or ${MAP}.`,
    canRetry: true,
  },
}

/** Thrown when the browser has WebGL but won't make a context. */
export class NoContextError extends Error {
  constructor() {
    super('WebGL context could not be created')
  }
}

/** Thrown when the 3D view's code can't be fetched. */
export class NotLoadedError extends Error {
  constructor() {
    super('The 3D view could not be loaded')
  }
}
