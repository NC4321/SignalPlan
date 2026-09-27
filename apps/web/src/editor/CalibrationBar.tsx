import { useId, useState } from 'react'
import { useEditor, useEditorStore } from './context.ts'
import { calibrateRecipe } from './tracing.ts'
import { parseLength } from './units.ts'

/**
 * Guides calibration (D22): click two points on the image a known distance
 * apart, then type that distance. The image rescales about the first point
 * and is locked.
 */
export function CalibrationBar() {
  const store = useEditorStore()
  const points = useEditor((s) => s.calibrationPoints)
  const units = useEditor((s) => s.units)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const id = useId()

  const cancel = () => {
    setText('')
    setInvalid(false)
    store.getState().setTool('select')
  }

  const apply = () => {
    const state = store.getState()
    const [a, b] = state.calibrationPoints
    const metres = parseLength(text, units)
    if (!a || !b || metres === undefined || metres <= 0) {
      setInvalid(true)
      return
    }
    state.edit(
      'Calibrate tracing image',
      calibrateRecipe(state.floorId, a, b, metres),
    )
    setText('')
    setInvalid(false)
    state.setTool('select')
  }

  return (
    <div
      className="calibration-bar"
      role="region"
      aria-label="Calibrate the image"
    >
      {points.length < 2 ? (
        <p>
          <strong>Set the image’s scale:</strong>{' '}
          {points.length === 0
            ? 'click one end of something whose length you know, such as a wall with a dimension on the plan.'
            : 'now click the other end.'}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <label htmlFor={id}>
            <strong>Real distance between the two points</strong>
          </label>
          <input
            id={id}
            value={text}
            autoFocus
            aria-invalid={invalid}
            placeholder={units === 'metric' ? 'e.g. 4.2' : `e.g. 13'9"`}
            onChange={(event) => setText(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
          />
          <button type="submit" className="primary">
            Set scale
          </button>
          {invalid && (
            <span className="field-error" role="alert">
              {units === 'metric' ? 'Try 4.2 or 420 cm' : `Try 13'9" or 13.75`}
            </span>
          )}
        </form>
      )}
      <button type="button" onClick={cancel}>
        {points.length < 2 ? 'Skip' : 'Cancel'}
      </button>
    </div>
  )
}
