// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { blankPlan, planToFile } from './editor/persistence.ts'
import { takeReloadAfterCrash } from './rescue.ts'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function Broken(): never {
  throw new Error('the screen broke')
}

let container: HTMLElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('ErrorBoundary (D91)', () => {
  it('shows its children while nothing is wrong', () => {
    act(() =>
      root.render(
        <ErrorBoundary getPlan={blankPlan} library={undefined}>
          <p>The editor</p>
        </ErrorBoundary>,
      ),
    )
    expect(container.textContent).toBe('The editor')
  })

  it('replaces a crashed editor with what happened and the two buttons', () => {
    act(() =>
      root.render(
        <ErrorBoundary getPlan={blankPlan} library={undefined}>
          <Broken />
        </ErrorBoundary>,
      ),
    )
    expect(container.querySelector('h1')?.textContent).toBe(
      'SignalPlan stopped working',
    )
    // The alert is the first sentence; the page itself isn't one.
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.tagName).toBe('P')
    expect(alert.textContent).toContain('Something went wrong')
    expect(document.activeElement).toBe(container.querySelector('h1'))
    const buttons = [...container.querySelectorAll('button')].map(
      (b) => b.textContent,
    )
    expect(buttons).toEqual(['Download your plan', 'Reload SignalPlan'])
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('the screen broke')
  })

  it('stops autosaving when it catches, and marks the reload for the next load', () => {
    const onCrash = vi.fn()
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    act(() =>
      root.render(
        <ErrorBoundary
          getPlan={blankPlan}
          library={undefined}
          onCrash={onCrash}
        >
          <Broken />
        </ErrorBoundary>,
      ),
    )
    expect(onCrash).toHaveBeenCalledTimes(1)
    const reloadButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reload SignalPlan',
    )!
    act(() => reloadButton.click())
    expect(reload).toHaveBeenCalled()
    expect(takeReloadAfterCrash()).toBe(true)
    expect(takeReloadAfterCrash()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('downloads the plan from the store, not from the crashed tree', async () => {
    const plan = { ...blankPlan(), name: 'Flat 4' }
    let saved: { text: string; name: string } | undefined
    URL.createObjectURL = vi.fn((blob: Blob) => {
      void blob.text().then((text) => (saved = { text, name: '' }))
      return 'blob:test'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        if (saved) saved.name = this.download
      })
    act(() =>
      root.render(
        <ErrorBoundary getPlan={() => plan} library={undefined}>
          <Broken />
        </ErrorBoundary>,
      ),
    )
    const download = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Download your plan',
    )!
    await act(async () => {
      download.click()
    })
    expect(click).toHaveBeenCalled()
    await vi.waitFor(() => expect(saved?.text).toBe(planToFile(plan)))
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'saved as a file',
    )
  })

  it('says so when there is no plan to download', async () => {
    act(() =>
      root.render(
        <ErrorBoundary
          getPlan={() => {
            throw new Error('store gone')
          }}
          library={undefined}
        >
          <Broken />
        </ErrorBoundary>,
      ),
    )
    const download = container.querySelector('button')!
    await act(async () => {
      download.click()
    })
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Couldn’t save your plan',
    )
  })
})
