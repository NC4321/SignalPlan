import { useEffect, useId, useRef, useState } from 'react'
import { useEditor, useEditorStore } from './context.ts'
import { GUIDE_STEPS, markGuideSeen } from './guide.ts'

/**
 * The guided first run (D90): a card in the corner of the plan, one step at
 * a time. A step moves on when you do what it says, or with Next; Skip ends
 * it. It doesn't take focus, so it never interrupts drawing; each step is
 * announced as it appears.
 */
export function Guide() {
  const open = useEditor((s) => s.guide)
  return open ? <GuideCard /> : null
}

function GuideCard() {
  const store = useEditorStore()
  const [index, setIndex] = useState(0)
  // The plan when the step began, to tell when its task is done.
  const start = useRef(store.getState().plan)
  const titleId = useId()
  const step = GUIDE_STEPS[index]!
  const last = index === GUIDE_STEPS.length - 1

  const close = () => {
    markGuideSeen()
    store.getState().setGuide(false)
  }
  const next = () => {
    if (last) return close()
    start.current = store.getState().plan
    setIndex(index + 1)
  }

  // Doing the step moves on by itself.
  useEffect(() => {
    const done = step.done
    if (!done) return
    return store.subscribe((state) => {
      if (state.plan === start.current || !done(start.current, state.plan)) {
        return
      }
      start.current = state.plan
      setIndex((i) => Math.min(i + 1, GUIDE_STEPS.length - 1))
    })
  }, [store, step])

  // Ring the control the step is about.
  useEffect(() => {
    if (!step.target) return
    const element = document.querySelector(step.target)
    element?.classList.add('guide-target')
    return () => element?.classList.remove('guide-target')
  }, [step])

  return (
    <section className="guide" aria-labelledby={titleId} aria-live="polite">
      <p className="guide-count">
        Step {index + 1} of {GUIDE_STEPS.length}
      </p>
      <h2 id={titleId}>{step.title}</h2>
      <p>{step.body}</p>
      <div className="guide-actions">
        {!last && (
          <button type="button" onClick={close}>
            Skip the guide
          </button>
        )}
        <button type="button" className="primary" onClick={next}>
          {last ? 'Done' : 'Next'}
        </button>
      </div>
    </section>
  )
}
