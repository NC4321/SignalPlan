import { BAND_PROFILES, type Coverage } from '@signalplan/engine'
import {
  BANDS,
  MIN_WALL_LENGTH_M,
  setWallLength,
  splitWall,
  WALL_MATERIALS,
  type AccessPoint,
  type Band,
  OPENING_MATERIALS,
  setOpeningWidth,
  type Floor,
  type Opening,
  type OpeningMaterial,
  type PlanNode,
  type Wall,
} from '@signalplan/floorplan'
import { useEffect, useId, useRef, useState } from 'react'
import { cssColour, QUALITY_BANDS, qualityOf } from '../quality.ts'
import { zoomAt } from './camera.ts'
import { useEditor, useEditorStore } from './context.ts'
import { deleteRecipe, describeSelection } from './selectTool.ts'
import { bearingDeg } from './snap.ts'
import { formatLength, parseLength, type Units } from './units.ts'
import {
  DEFAULT_OPENING_WIDTH_M,
  heatmapShown,
  tracingHidesHeatmap,
} from './store.ts'
import { FileMenu } from './FileMenu.tsx'
import { TracingSection } from './TracingSection.tsx'
import type { SaveStatus } from './autosave.ts'
import { MOD_KEY, signalAt } from './util.ts'
import { drawWall, WALL_STYLES } from './wallStyles.ts'

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
        <FileMenu />
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
      <button
        type="button"
        aria-pressed={tool === 'wall'}
        onClick={() => store.getState().setTool('wall')}
        title="Draw walls (W)"
      >
        <span aria-hidden="true">▭</span>
        <span className="tool-name">Wall</span>
      </button>
      <button
        type="button"
        aria-pressed={tool === 'door'}
        onClick={() => store.getState().setTool('door')}
        title="Add doors (D)"
      >
        <span aria-hidden="true">⌷</span>
        <span className="tool-name">Door</span>
      </button>
      <button
        type="button"
        aria-pressed={tool === 'window'}
        onClick={() => store.getState().setTool('window')}
        title="Add windows (N)"
      >
        <span aria-hidden="true">▤</span>
        <span className="tool-name">Window</span>
      </button>
    </nav>
  )
}

export function PropertiesPanel({ open }: { open: boolean }) {
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const floor = plan.floors.find((f) => f.id === floorId)!

  const only = selection.length === 1 ? selection[0] : undefined
  const ap =
    only?.kind === 'accessPoint'
      ? plan.accessPoints.find((a) => a.id === only.id)
      : undefined
  const wall =
    only?.kind === 'wall'
      ? floor.walls.find((w) => w.id === only.id)
      : undefined
  const node =
    only?.kind === 'node'
      ? floor.nodes.find((n) => n.id === only.id)
      : undefined
  const opening =
    only?.kind === 'opening'
      ? floor.openings.find((o) => o.id === only.id)
      : undefined

  let details
  if (tool === 'wall' && selection.length === 0) details = <WallToolSection />
  else if ((tool === 'door' || tool === 'window') && selection.length === 0) {
    details = <OpeningToolSection kind={tool} />
  } else if (opening)
    details = <OpeningSection opening={opening} floor={floor} />
  else if (ap) details = <AccessPointSection ap={ap} />
  else if (wall) details = <WallSection wall={wall} floor={floor} />
  else if (node) details = <CornerSection node={node} floor={floor} />
  else if (selection.length > 1) details = <MultipleSection />
  else
    details = (
      <>
        <PlanSection />
        {floor.background && <TracingSection background={floor.background} />}
      </>
    )

  return (
    <aside
      id="properties"
      className="properties"
      data-open={open || undefined}
      aria-label="Properties"
    >
      {details}

      {tool !== 'wall' && (
        <section>
          <h2>Walls</h2>
          <ul className="wall-legend">
            {WALL_MATERIALS.map((material) => (
              <li key={material}>
                <WallSwatch material={material} />
                {WALL_STYLES[material].label}
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

const SAVE_MESSAGES: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Saving…',
  saved: 'Saved in this browser',
  full: 'Not saved: browser storage is full. Save to a file.',
  unavailable: 'Not saved: this browser blocks storage. Save to a file.',
}

export function StatusBar({
  coverage,
  saveStatus,
}: {
  coverage: Coverage | undefined
  saveStatus: SaveStatus
}) {
  const store = useEditorStore()
  const pointer = useEditor((s) => s.pointer)
  const units = useEditor((s) => s.units)
  const showHeatmap = useEditor(heatmapShown)
  const tracing = useEditor((s) => s.showHeatmap && tracingHidesHeatmap(s))
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
        {tracing && (
          <span className="tracing-note"> · Heatmap hidden while tracing</span>
        )}
      </p>
      <p
        className="save-status"
        data-problem={
          saveStatus === 'full' || saveStatus === 'unavailable' || undefined
        }
        role="status"
      >
        {SAVE_MESSAGES[saveStatus]}
      </p>
      <div className="zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.25)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button type="button" onClick={fit} title="Fit plan to window">
          Fit
        </button>
      </div>
    </footer>
  )
}

/** A short sample of a wall material, drawn exactly as on the plan. */
const materialLabel = (material: OpeningMaterial) =>
  material === 'open' ? 'Open (no door)' : WALL_STYLES[material].label

function WallSwatch({ material }: { material: OpeningMaterial }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const ratio = window.devicePixelRatio || 1
    element.width = 40 * ratio
    element.height = 16 * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const casing = getComputedStyle(element)
      .getPropertyValue('--wall-casing')
      .trim()
    if (material === 'open') {
      // An open doorway: just the two end marks.
      context.strokeStyle = casing
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(8, 2)
      context.lineTo(8, 14)
      context.moveTo(32, 2)
      context.lineTo(32, 14)
      context.stroke()
      return
    }
    drawWall(
      context,
      { x: 5, y: 8 },
      { x: 35, y: 8 },
      WALL_STYLES[material],
      7,
      casing,
    )
  }, [material])
  return <canvas ref={canvas} className="wall-swatch" aria-hidden="true" />
}

function WallToolSection() {
  const store = useEditorStore()
  const wallMaterial = useEditor((s) => s.wallMaterial)
  return (
    <section>
      <h2>Wall tool</h2>
      <p className="kind">Click to place corners</p>
      <MaterialPicker
        legend="Material for new walls"
        name="wall-material"
        value={wallMaterial}
        onChange={(material) => store.getState().setWallMaterial(material)}
      />
      <ul className="hint tips">
        <li>
          Double-click, Enter or Esc finishes a chain; clicking the first corner
          closes a room.
        </li>
        <li>Type a number for an exact length; Tab for an angle.</li>
        <li>
          Snaps to corners, walls, 15° steps and the grid. Hold Alt to place
          freely.
        </li>
        <li>{MOD_KEY}Z steps back one corner.</li>
      </ul>
    </section>
  )
}

function MaterialPicker<M extends OpeningMaterial>({
  legend,
  name,
  value,
  onChange,
  materials = WALL_MATERIALS as readonly OpeningMaterial[] as readonly M[],
}: {
  legend: string
  name: string
  value: M
  onChange: (material: M) => void
  materials?: readonly M[]
}) {
  return (
    <fieldset className="material-picker">
      <legend>{legend}</legend>
      {materials.map((material) => (
        <label key={material}>
          <input
            type="radio"
            name={name}
            value={material}
            checked={value === material}
            onChange={() => onChange(material)}
          />
          <WallSwatch material={material} />
          {materialLabel(material)}
        </label>
      ))}
    </fieldset>
  )
}

function AccessPointSection({ ap }: { ap: AccessPoint }) {
  const units = useEditor((s) => s.units)
  return (
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
              {radio.txPowerDbm ?? BAND_PROFILES[radio.band].defaultTxPowerDbm}{' '}
              dBm EIRP{radio.txPowerDbm === undefined ? ' (default)' : ''}
            </dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        Drag it, or use the arrow keys (Shift for bigger steps).
      </p>
    </section>
  )
}

function WallSection({ wall, floor }: { wall: Wall; floor: Floor }) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const a = floor.nodes.find((n) => n.id === wall.from)!
  const b = floor.nodes.find((n) => n.id === wall.to)!
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const openings = floor.openings.filter((o) => o.wallId === wall.id).length
  const floorId = floor.id

  const edit = (label: string, change: (target: Floor) => void) =>
    store.getState().edit(label, (plan) => {
      change(plan.floors.find((f) => f.id === floorId)!)
    })

  return (
    <section>
      <h2>Wall</h2>
      <p className="kind">{WALL_STYLES[wall.material].label}</p>
      <LengthField
        label="Length"
        metres={length}
        units={units}
        onCommit={(metres) =>
          edit('Change wall length', (target) =>
            setWallLength(target, wall.id, metres),
          )
        }
      />
      <dl>
        <dt>Angle</dt>
        <dd>{Math.round(bearingDeg(a, b))}°</dd>
        <dt>Doors and windows</dt>
        <dd>{openings}</dd>
      </dl>
      <p className="hint">
        Changing the length keeps the start corner and moves the end one.
      </p>
      <MaterialPicker
        legend="Material"
        name="selected-wall-material"
        value={wall.material}
        onChange={(material) =>
          edit('Change wall material', (target) => {
            const w = target.walls.find((x) => x.id === wall.id)
            if (w) w.material = material
          })
        }
      />
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            let created: string | undefined
            edit('Split wall', (target) => {
              created = splitWall(target, wall.id, {
                x: (a.x + b.x) / 2,
                y: (a.y + b.y) / 2,
              })
            })
            if (created) {
              store.getState().select([{ kind: 'node', id: created }])
            }
          }}
        >
          Split in half
        </button>
        <DeleteButton />
      </div>
      <p className="hint">Double-click a wall to split it anywhere.</p>
    </section>
  )
}

function CornerSection({ node, floor }: { node: PlanNode; floor: Floor }) {
  const units = useEditor((s) => s.units)
  const walls = floor.walls.filter(
    (w) => w.from === node.id || w.to === node.id,
  ).length
  return (
    <section>
      <h2>Corner</h2>
      <p className="kind">
        Joins {walls} wall{walls === 1 ? '' : 's'}
      </p>
      <dl>
        <dt>Position</dt>
        <dd>
          {formatLength(node.x, units)}, {formatLength(node.y, units)}
        </dd>
      </dl>
      <p className="hint">
        {walls === 2
          ? 'Deleting it joins its two walls into one.'
          : 'Deleting it removes the walls attached to it.'}{' '}
        Drop it on another corner or a wall to join them.
      </p>
      <div className="actions">
        <DeleteButton />
      </div>
    </section>
  )
}

function MultipleSection() {
  const selection = useEditor((s) => s.selection)
  return (
    <section>
      <h2>{selection.length} selected</h2>
      <p className="kind">Shift-click to add or remove items</p>
      <p className="hint">Arrow keys move them together.</p>
      <div className="actions">
        <DeleteButton />
      </div>
    </section>
  )
}

function PlanSection() {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const floor = plan.floors.find((f) => f.id === floorId)
  return (
    <section>
      <h2>{plan.name}</h2>
      <p className="kind">{floor?.name}</p>
      <TextField
        label="Plan name"
        value={plan.name}
        onCommit={(name) => store.getState().renamePlan(name)}
      />
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
                  store.getState().select([{ kind: 'accessPoint', id: a.id }])
                }
              >
                {a.name}
              </button>
            </li>
          ))}
      </ul>
    </section>
  )
}

/** Deletes the selected walls and corners. */
function DeleteButton() {
  const store = useEditorStore()
  const selection = useEditor((s) => s.selection)
  const removable = selection.filter((i) => i.kind !== 'accessPoint')
  return (
    <button
      type="button"
      className="danger"
      disabled={removable.length === 0}
      title="Delete (Delete key)"
      onClick={() => {
        const state = store.getState()
        state.edit(
          `Delete ${describeSelection(removable)}`,
          deleteRecipe(state.floorId, removable),
        )
      }}
    >
      Delete
    </button>
  )
}

/**
 * A length shown in the current units and editable as text. Enter or leaving
 * the field applies it; Esc restores the current value.
 */
function LengthField({
  label,
  metres,
  units,
  onCommit,
}: {
  label: string
  metres: number
  units: Units
  onCommit: (metres: number) => void
}) {
  const formatted = formatLength(metres, units)
  // What's being typed; undefined shows the current value.
  const [draft, setDraft] = useState<string>()
  const [invalid, setInvalid] = useState(false)
  const id = useId()
  const text = draft ?? formatted

  const reset = () => {
    setDraft(undefined)
    setInvalid(false)
  }
  const commit = () => {
    if (draft === undefined || draft === formatted) return reset()
    const value = parseLength(draft, units)
    if (value === undefined || value < MIN_WALL_LENGTH_M) {
      setInvalid(true)
      return
    }
    reset()
    onCommit(value)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') reset()
        }}
        autoComplete="off"
        inputMode="decimal"
      />
      {invalid && (
        <p className="field-error" role="alert">
          {units === 'metric' ? 'Try 3.5 or 350 cm' : `Try 12'6" or 12.5`}
        </p>
      )}
    </div>
  )
}

function OpeningToolSection({ kind }: { kind: 'door' | 'window' }) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const material = useEditor((s) => s.openingMaterial[kind])
  const noun = kind === 'door' ? 'door' : 'window'
  return (
    <section>
      <h2>{kind === 'door' ? 'Door tool' : 'Window tool'}</h2>
      <p className="kind">Click a wall to add a {noun}</p>
      <MaterialPicker
        legend={`Material for new ${noun}s`}
        name={`${kind}-material`}
        value={material}
        materials={OPENING_MATERIALS}
        onChange={(m) => store.getState().setOpeningMaterial(kind, m)}
      />
      <ul className="hint tips">
        <li>
          New {noun}s are {formatLength(DEFAULT_OPENING_WIDTH_M[kind], units)}{' '}
          wide; change the width after placing.
        </li>
        <li>Near a corner or another opening, it slides to fit.</li>
        <li>Esc returns to Select.</li>
      </ul>
    </section>
  )
}

function OpeningSection({
  opening,
  floor,
}: {
  opening: Opening
  floor: Floor
}) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const floorId = floor.id
  const edit = (label: string, change: (target: Floor) => void) =>
    store.getState().edit(label, (plan) => {
      change(plan.floors.find((f) => f.id === floorId)!)
    })
  const noun = opening.kind === 'door' ? 'Door' : 'Window'

  return (
    <section>
      <h2>{noun}</h2>
      <p className="kind">{materialLabel(opening.material)}</p>
      <fieldset className="segmented opening-kind">
        <legend className="visually-hidden">Kind</legend>
        {(['door', 'window'] as const).map((kind) => (
          <label key={kind}>
            <input
              type="radio"
              name="opening-kind"
              value={kind}
              checked={opening.kind === kind}
              onChange={() =>
                edit(`Make it a ${kind}`, (target) => {
                  const o = target.openings.find((x) => x.id === opening.id)
                  if (o) o.kind = kind
                })
              }
            />
            {kind === 'door' ? 'Door' : 'Window'}
          </label>
        ))}
      </fieldset>
      <LengthField
        label="Width"
        metres={opening.widthM}
        units={units}
        onCommit={(metres) =>
          edit(`Change ${noun.toLowerCase()} width`, (target) => {
            setOpeningWidth(target, opening.id, metres)
          })
        }
      />
      <p className="hint">
        Grows about its centre, up to the next corner or opening. Drag it along
        its wall to move it.
      </p>
      <MaterialPicker
        legend="Material"
        name="selected-opening-material"
        value={opening.material}
        materials={OPENING_MATERIALS}
        onChange={(material) =>
          edit(`Change ${noun.toLowerCase()} material`, (target) => {
            const o = target.openings.find((x) => x.id === opening.id)
            if (o) o.material = material
          })
        }
      />
      <div className="actions">
        <DeleteButton />
      </div>
    </section>
  )
}

/** A short text setting, applied on Enter or when leaving the field. */
function TextField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState<string>()
  const id = useId()
  const commit = () => {
    if (draft !== undefined) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft ?? value}
        maxLength={200}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setDraft(undefined)
        }}
        autoComplete="off"
      />
    </div>
  )
}
