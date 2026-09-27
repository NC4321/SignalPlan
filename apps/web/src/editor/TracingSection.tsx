import type { Background } from '@signalplan/floorplan'
import { useId, useRef } from 'react'
import { useEditor, useEditorStore } from './context.ts'
import {
  backgroundRecipe,
  removeBackgroundRecipe,
  type BackgroundSettings,
} from './tracing.ts'
import { useTracing } from './tracingContext.ts'
import { formatLength } from './units.ts'

/**
 * The floor's tracing image (D22): how it shows, and recalibrating, replacing
 * or removing it. Every change is an undoable edit; one slider drag is one.
 */
export function TracingSection({ background }: { background: Background }) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const { chooseImage, notice } = useTracing()
  const opacityId = useId()
  /** True while the opacity slider's gesture is open. */
  const sliding = useRef(false)

  const change = (label: string, settings: BackgroundSettings) => {
    const state = store.getState()
    state.edit(label, backgroundRecipe(state.floorId, settings))
  }

  const slide = (opacity: number) => {
    const state = store.getState()
    if (!sliding.current) {
      if (state.gesture) return
      state.beginGesture()
      sliding.current = true
    }
    state.updateGesture(backgroundRecipe(state.floorId, { opacity }))
  }

  const endSlide = () => {
    if (!sliding.current) return
    sliding.current = false
    store.getState().endGesture('Change tracing image opacity')
  }

  const width = background.widthPx * background.metresPerPixel
  const height = background.heightPx * background.metresPerPixel

  return (
    <section aria-labelledby={`${opacityId}-heading`}>
      <h2 id={`${opacityId}-heading`}>Tracing image</h2>
      <p className="kind">
        {formatLength(width, units)} × {formatLength(height, units)} on the plan
      </p>
      <div className="field">
        <label htmlFor={opacityId}>
          Opacity {Math.round(background.opacity * 100)}%
        </label>
        <input
          id={opacityId}
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(background.opacity * 100)}
          disabled={!background.visible}
          onChange={(event) => slide(Number(event.target.value) / 100)}
          onPointerUp={endSlide}
          onKeyUp={endSlide}
          onBlur={endSlide}
        />
      </div>
      <label className="toggle tracing-toggle">
        <input
          type="checkbox"
          checked={background.visible}
          onChange={(event) =>
            change(
              event.target.checked
                ? 'Show tracing image'
                : 'Hide tracing image',
              {
                visible: event.target.checked,
              },
            )
          }
        />
        Show image
      </label>
      <label className="toggle tracing-toggle">
        <input
          type="checkbox"
          checked={background.locked}
          onChange={(event) =>
            change(
              event.target.checked
                ? 'Lock tracing image'
                : 'Unlock tracing image',
              {
                locked: event.target.checked,
              },
            )
          }
        />
        Lock in place
      </label>
      {notice && <p className="hint">{notice}</p>}
      <div className="actions">
        <button
          type="button"
          disabled={!background.visible}
          onClick={() => store.getState().setTool('calibrate')}
        >
          Recalibrate
        </button>
        <button type="button" onClick={chooseImage}>
          Replace image…
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            const state = store.getState()
            state.edit(
              'Remove tracing image',
              removeBackgroundRecipe(state.floorId),
            )
          }}
        >
          Remove
        </button>
      </div>
      <p className="hint">
        {background.locked
          ? 'Unlock the image to drag it into place.'
          : 'Drag the image to line it up with your walls.'}
      </p>
    </section>
  )
}
