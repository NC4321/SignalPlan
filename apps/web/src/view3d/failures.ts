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
    message: `The 3D view needs WebGL, and this browser has it turned off or doesn’t support it. Try turning on hardware acceleration in the browser’s settings, or ${MAP}.`,
    canRetry: false,
  },
  'no-context': {
    message: `The 3D view couldn’t start: the browser wouldn’t give it the graphics it needs. This can happen when many tabs are using the graphics card. Close some tabs and try again, or ${MAP}.`,
    canRetry: true,
  },
  lost: {
    message: `The graphics card stopped drawing the 3D view. This can happen when the computer sleeps or another tab needs the graphics. Try again, or ${MAP}.`,
    canRetry: true,
  },
  // A failed import is remembered by the browser until the page reloads.
  'not-loaded': {
    message: `The 3D view’s code couldn’t be loaded, usually because the connection dropped. Check it and reload the page, or ${MAP}.`,
    canRetry: false,
    reload: true,
  },
  broken: {
    message: `The 3D view couldn’t be shown. If your connection dropped while it loaded, check it and try again; otherwise ${MAP}.`,
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
