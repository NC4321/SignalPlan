import { BAND_PROFILES, type Coverage } from '@signalplan/engine'
import { BANDS, type Band } from '@signalplan/floorplan'
import { cssColour, QUALITY_BANDS, qualityOf } from '../quality.ts'
import { zoomAt } from './camera.ts'
import { useEditor, useEditorStore } from './context.ts'
import { formatLength, type Units } from './units.ts'
import { MOD_KEY, signalAt } from './util.ts'

const BAND_LABELS: Record<Band, string> = {
  '2.4GHz': '2.4 GHz',
  '5GHz': '5 GHz',
  '6GHz': '6 GHz',
}

const MODEL_URL = 'https://github.com/NC4321/SignalPlan/blob/main/docs/MODEL.md'

export function TopBar({
  panelOpen,
  onTogglePanel,
}: {
  panelOpen: boolean
  onTogglePanel: () => void
}) {
  const store = useEditorStore()
  const planName = useEditor((s) => s.plan.name)
  const undoLabel = useEditor((s) => s.past.at(-1)?.label)
  const redoLabel = useEditor((s) => s.future.at(-1)?.label)
  const units = useEditor((s) => s.units)
  const band = useEditor((s) => s.band)
  const showHeatmap = useEditor((s) => s.showHeatmap)

  return (
    <header className="top-bar">
      <div className="brand">
        <strong>SignalPlan</strong>
        <span className="plan-name">{planName}</span>
      </div>

      <div className="top-group" role="group" aria-label="History">
        <button
          type="button"
          disabled={!undoLabel}
          onClick={() => store.getState().undo()}
          title={
            undoLabel ? `Undo ${undoLabel} (${MOD_KEY}Z)` : 'Nothing to undo'
          }
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!redoLabel}
          onClick={() => store.getState().redo()}
          title={
            redoLabel
              ? `Redo ${redoLabel} (${MOD_KEY}Shift+Z)`
              : 'Nothing to redo'
          }
        >
          Redo
        </button>
      </div>

      <Segmented
        label="Band"
        name="band"
        value={band}
        options={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
        onChange={(b) => store.getState().setBand(b)}
      />

      <Segmented
        label="Units"
        name="units"
        value={units}
        options={[
          { value: 'metric', label: 'Metric' },
          { value: 'imperial', label: 'Imperial' },
        ]}
        onChange={(u) => store.getState().setUnits(u as Units)}
      />

      <label className="toggle">
        <input
          type="checkbox"
          checked={showHeatmap}
          onChange={(event) =>
            store.getState().setShowHeatmap(event.target.checked)
          }
        />
        Heatmap
      </label>

      <button
        type="button"
        className="panel-toggle"
        aria-expanded={panelOpen}
        aria-controls="properties"
        onClick={onTogglePanel}
      >
        Details
      </button>
    </header>
  )
}

function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string
  name: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

export function Toolbar() {
  const store = useEditorStore()
  const tool = useEditor((s) => s.tool)
  return (
    <nav className="toolbar" aria-label="Tools">
      <button
        type="button"
        aria-pressed={tool === 'select'}
        onClick={() => store.getState().setTool('select')}
        title="Select and move (V)"
      >
        <span aria-hidden="true">↖</span>
        <span className="tool-name">Select</span>
      </button>
    </nav>
  )
}

export function PropertiesPanel({ open }: { open: boolean }) {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const selection = useEditor((s) => s.selection)
  const units = useEditor((s) => s.units)
  const floor = plan.floors.find((f) => f.id === floorId)

  const ap =
    selection?.kind === 'accessPoint'
      ? plan.accessPoints.find((a) => a.id === selection.id)
      : undefined

  return (
    <aside
      id="properties"
      className="properties"
      data-open={open || undefined}
      aria-label="Properties"
    >
      {ap ? (
        <section>
          <h2>{ap.name}</h2>
          <p className="kind">Access point</p>
          <dl>
            <dt>Position</dt>
            <dd>
              {formatLength(ap.x, units)}, {formatLength(ap.y, units)}
            </dd>
            <dt>Mounted at</dt>
            <dd>{formatLength(ap.heightM, units)} above the floor</dd>
            {ap.radios.map((radio) => (
              <div key={radio.band} className="dl-row">
                <dt>{BAND_LABELS[radio.band]}</dt>
                <dd>
                  {radio.txPowerDbm ??
                    BAND_PROFILES[radio.band].defaultTxPowerDbm}{' '}
                  dBm EIRP{radio.txPowerDbm === undefined ? ' (default)' : ''}
                </dd>
              </div>
            ))}
          </dl>
          <p className="hint">
            Drag it, or use the arrow keys (Shift for bigger steps).
          </p>
        </section>
      ) : (
        <section>
          <h2>{plan.name}</h2>
          <p className="kind">{floor?.name}</p>
          <dl>
            <dt>Walls</dt>
            <dd>{floor?.walls.length ?? 0}</dd>
            <dt>Doors and windows</dt>
            <dd>{floor?.openings.length ?? 0}</dd>
          </dl>
          <h3>Access points</h3>
          <ul className="object-list">
            {plan.accessPoints
              .filter((a) => a.floorId === floorId)
              .map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() =>
                      store.getState().select({ kind: 'accessPoint', id: a.id })
                    }
                  >
                    {a.name}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Signal quality</h2>
        <ul className="legend">
          {QUALITY_BANDS.map((q, i) => (
            <li key={q.label}>
              <span className="swatch" style={{ background: cssColour(q) }} />
              <span className="legend-label">{q.label}</span>
              <span className="legend-range">
                {i === 0
                  ? `≥ ${q.minDbm}`
                  : `${q.minDbm} to ${QUALITY_BANDS[i - 1]!.minDbm}`}{' '}
                dBm
              </span>
            </li>
          ))}
          <li>
            <span className="swatch swatch-none" />
            <span className="legend-label">No signal</span>
            <span className="legend-range">
              {`< ${QUALITY_BANDS.at(-1)!.minDbm}`} dBm
            </span>
          </li>
        </ul>
        <p className="hint">
          Predictions come from a simplified model.{' '}
          <a href={MODEL_URL}>How it works and its limits</a>
        </p>
      </section>
    </aside>
  )
}

export function StatusBar({ coverage }: { coverage: Coverage | undefined }) {
  const store = useEditorStore()
  const pointer = useEditor((s) => s.pointer)
  const units = useEditor((s) => s.units)
  const showHeatmap = useEditor((s) => s.showHeatmap)
  const signal =
    pointer && coverage && showHeatmap ? signalAt(coverage, pointer) : undefined
  const quality = signal === undefined ? undefined : qualityOf(signal)

  const zoomBy = (factor: number) => {
    const current = store.getState().camera
    const canvas = document.querySelector('.editor-canvas')
    if (!current || !canvas) return
    const rect = canvas.getBoundingClientRect()
    store
      .getState()
      .setCamera(
        zoomAt(current, { x: rect.width / 2, y: rect.height / 2 }, factor),
      )
  }
  const fit = () => {
    // Clearing the camera makes the canvas fit the plan again.
    store.getState().setCamera(undefined)
  }

  return (
    <footer className="status-bar">
      <p className="readout" aria-live="polite">
        {pointer
          ? `${formatLength(pointer.x, units)}, ${formatLength(pointer.y, units)}`
          : 'Point at the plan'}
        {signal !== undefined &&
          ` · ${signal.toFixed(0)} dBm · ${quality?.label ?? 'No signal'}`}
      </p>
      <div className="zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
          −
        </button>
        <button type="button" onClick={() => zoomBy(1.25)} title="Zoom in">
          +
        </button>
        <button type="button" onClick={fit} title="Fit plan to window">
          Fit
        </button>
      </div>
    </footer>
  )
}
