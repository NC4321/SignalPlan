import type { Plan } from '@signalplan/floorplan'
import { Component, createRef, type ReactNode } from 'react'
import type { PlanLibrary } from './editor/library.ts'
import { downloadRescue, markReloadAfterCrash } from './rescue.ts'

interface Props {
  children: ReactNode
  /** The open plan, read from the editor's store (outside React). */
  getPlan: () => Plan
  library: PlanLibrary | undefined
  /** Called when the editor crashes, e.g. to stop autosaving. */
  onCrash?: () => void
}

interface State {
  error: Error | undefined
  /** Set once Download has run: whether it saved a file. */
  downloaded: boolean | undefined
}

/**
 * The last line of defence (D91): if anything in the editor throws while
 * rendering, this replaces it with a plain panel that says so and offers the
 * plan as a file before reloading. It sits outside the editor and reads the
 * plan from the store, so it works however broken the editor tree is.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined, downloaded: undefined }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  private readonly heading = createRef<HTMLHeadingElement>()

  override componentDidCatch(error: unknown) {
    console.error('SignalPlan stopped after an error:', error)
    try {
      this.props.onCrash?.()
    } catch {
      // Nothing more to do if stopping the autosaver failed.
    }
  }

  override componentDidMount() {
    // A crash while the app first draws mounts the boundary with its error.
    if (this.state.error) this.heading.current?.focus()
  }

  override componentDidUpdate(_: Props, previous: State) {
    // Screen readers start at the new screen; the alert is its first line.
    if (this.state.error && !previous.error) this.heading.current?.focus()
  }

  private download = async () => {
    let ok = false
    try {
      ok = await downloadRescue(this.props.getPlan, this.props.library)
    } catch {
      // Reported below.
    }
    this.setState({ downloaded: ok })
  }

  private reload = () => {
    markReloadAfterCrash()
    window.location.reload()
  }

  override render() {
    const { error, downloaded } = this.state
    if (!error) return this.props.children
    return (
      <main className="crash">
        <h1 ref={this.heading} tabIndex={-1}>
          SignalPlan stopped working
        </h1>
        <p role="alert">
          Something went wrong while drawing the screen, so the editor can’t
          carry on. Download your plan first, then reload to start again.
        </p>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void this.download()}
          >
            Download your plan
          </button>
          <button type="button" onClick={this.reload}>
            Reload SignalPlan
          </button>
        </div>
        <p role="status" className="hint">
          {downloaded === true &&
            'Your plan was saved as a file. Open it in SignalPlan with File › Open file.'}
          {downloaded === false &&
            'Couldn’t save your plan as a file. Reload: a copy may still be in My plans.'}
        </p>
        <details>
          <summary>What went wrong</summary>
          <pre>{error.message || String(error)}</pre>
        </details>
      </main>
    )
  }
}
