import { MAP_LABELS } from '../mapView.ts'
import { useState } from 'react'
import { useEditorStore } from './context.ts'
import { BAND_LABELS } from './coverageText.ts'
import { Dialog } from './Dialog.tsx'
import {
  downloadImage,
  EXPORT_SIZES,
  exportFileName,
  type ExportSize,
} from './exportImage.ts'
import type { Theme } from './palettes.ts'

/** File › Export image…: size and theme, then a PNG download (#44). */
export function ExportDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const store = useEditorStore()
  const [size, setSize] = useState<ExportSize>('medium')
  const [theme, setTheme] = useState<Theme>('light')
  const [problem, setProblem] = useState<string>()
  const { plan, band, show } = store.getState()

  const exportImage = async () => {
    const state = store.getState()
    try {
      await downloadImage({
        plan: state.plan,
        floorId: state.floorId,
        band: state.band,
        show: state.show,
        units: state.units,
        theme,
        size,
      })
      setProblem(undefined)
      onClose()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Dialog
      open={open}
      title="Export image"
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void exportImage()}
          >
            Export PNG
          </button>
        </>
      }
    >
      <p>
        The plan with its {BAND_LABELS[band]}{' '}
        {show === 'signal'
          ? 'heatmap'
          : `${MAP_LABELS[show].toLowerCase()} map`}
        , legend, summary and a scale bar, saved as “
        {exportFileName(plan, band, show)}”.
      </p>
      <fieldset className="choices">
        <legend>Size</legend>
        {EXPORT_SIZES.map((s) => (
          <label key={s.id}>
            <input
              type="radio"
              name="export-size"
              value={s.id}
              checked={size === s.id}
              onChange={() => setSize(s.id)}
            />
            {s.label}{' '}
            <span className="choice-note">
              {s.width} × {s.height}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="choices">
        <legend>Theme</legend>
        {(['light', 'dark'] as const).map((t) => (
          <label key={t}>
            <input
              type="radio"
              name="export-theme"
              value={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
            />
            {t === 'light' ? 'Light' : 'Dark'}
          </label>
        ))}
      </fieldset>
      {problem && (
        <p className="field-error" role="alert">
          Couldn’t export: {problem}
        </p>
      )}
    </Dialog>
  )
}
