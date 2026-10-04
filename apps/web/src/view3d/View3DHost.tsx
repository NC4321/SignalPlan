import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import {
  NoContextError,
  NotLoadedError,
  type View3DFailure,
} from './failures.ts'
import type { View3DProps } from './View3D.tsx'
import { View3DFailed, View3DLoading } from './ThreeDStatus.tsx'

// One lazy component for the page, so the code loads once; a failed import
// is remembered by the browser until the page reloads, so there's no retry.
const View3D = lazy(() =>
  import('./View3D.tsx').catch(() => {
    throw new NotLoadedError()
  }),
)

/**
 * The 3D view as App shows it (D93): the chunk loads on first use, so it
 * says it's loading; a chunk that won't load, or a view that throws while
 * drawing, says so, with a way to try again or go back to 2D, instead of
 * taking the whole editor down.
 */
export function View3DHost(props: View3DProps) {
  const [attempt, setAttempt] = useState(0)
  return (
    <Catcher key={attempt} onRetry={() => setAttempt((n) => n + 1)}>
      <Suspense fallback={<View3DLoading />}>
        <View3D {...props} />
      </Suspense>
    </Catcher>
  )
}

class Catcher extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: View3DFailure | undefined }
> {
  override state: { failed: View3DFailure | undefined } = {
    failed: undefined,
  }
  static getDerivedStateFromError(error: unknown) {
    const failed: View3DFailure =
      error instanceof NoContextError
        ? 'no-context'
        : error instanceof NotLoadedError
          ? 'not-loaded'
          : 'broken'
    return { failed }
  }
  override render() {
    return this.state.failed ? (
      <View3DFailed failure={this.state.failed} onRetry={this.props.onRetry} />
    ) : (
      this.props.children
    )
  }
}
