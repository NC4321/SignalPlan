import { BAND_PROFILES, MAX_ADDED, type Coverage } from '@signalplan/engine'
import {
  BANDS,
  COVERAGE_TARGETS,
  DEFAULT_FLOOR_MATERIAL,
  EIRP_RANGE_DBM,
  FLOOR_MATERIALS,
  MIN_WALL_LENGTH_M,
  NEW_ACCESS_POINT_HEIGHT_M,
  polygonArea,
  setRadioOn,
  setRadioPower,
  type Plan,
  setWallLength,
  splitWall,
  WALL_MATERIALS,
  type AccessPoint,
  type Band,
  type CoverageTarget,
  OPENING_MATERIALS,
  setOpeningWidth,
  stackedFloors,
  type Floor,
  type FloorMaterial,
  type FloorOpening,
  type Opening,
  type OpeningMaterial,
  type PlanNode,
  type Wall,
} from '@signalplan/floorplan'
import type { Draft } from 'immer'
import { useEffect, useId, useRef, useState } from 'react'
import {
  cssColour,
  DEFAULT_TARGET,
  QUALITY_BANDS,
  qualityOf,
  targetBand,
} from '../quality.ts'
import { zoomAt } from './camera.ts'
import { BAND_LABELS, settledAnnouncement } from './coverageText.ts'
import { useEditor, useEditorStore } from './context.ts'
import { deleteRecipe, describeSelection } from './selectTool.ts'
import { bearingDeg } from './snap.ts'
import {
  formatArea,
  formatLength,
  parseLength,
  parseSignedLength,
  type Units,
} from './units.ts'
import {
  canCutFloor,
  DEFAULT_OPENING_WIDTH_M,
  heatmapShown,
  tracingHidesHeatmap,
} from './store.ts'
import { FileMenu } from './FileMenu.tsx'
import { TracingSection } from './TracingSection.tsx'
import type { SaveStatus } from './autosave.ts'
import { MOD_KEY, signalAt } from './util.ts'
import { drawWall, WALL_STYLES } from './wallStyles.ts'
import {
  COVERAGE_GOALS,
  goalText,
  planSearch,
  suggestionSummary,
  type CoverageGoal,
} from './optimizer.ts'
import { useOptimizer } from './optimizerContext.ts'

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

const TOOLS = [
  {
    tool: 'select',
    name: 'Select',
    icon: '↖',
    key: 'V',
    title: 'Select and move',
  },
  { tool: 'wall', name: 'Wall', icon: '▭', key: 'W', title: 'Draw walls' },
  { tool: 'door', name: 'Door', icon: '⌷', key: 'D', title: 'Add doors' },
  { tool: 'window', name: 'Window', icon: '▤', key: 'N', title: 'Add windows' },
  {
    tool: 'floorOpening',
    name: 'Opening',
    label: 'Floor opening',
    icon: '▨',
    key: 'O',
    title: 'Add stairwells and atriums: openings in the floor',
  },
  {
    tool: 'accessPoint',
    name: 'AP',
    label: 'Access point',
    icon: '◉',
    key: 'A',
    title: 'Add access points',
  },
] as const

/**
 * The tools, as an ARIA toolbar: Tab reaches the current tool, arrow keys
 * move between tools, Enter or Space picks one (D23).
 */
export function Toolbar() {
  const store = useEditorStore()
  const tool = useEditor((s) => s.tool)
  // The lowest floor has no slab to cut (D54).
  const canCut = useEditor((s) => canCutFloor(s.plan, s.floorId))
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(
    0,
    TOOLS.findIndex((t) => t.tool === tool),
  )
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      onKeyDown={(event) => {
        const focused = buttons.current.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        if (focused === -1) return
        const last = TOOLS.length - 1
        const target = {
          ArrowDown: focused === last ? 0 : focused + 1,
          ArrowRight: focused === last ? 0 : focused + 1,
          ArrowUp: focused === 0 ? last : focused - 1,
          ArrowLeft: focused === 0 ? last : focused - 1,
          Home: 0,
          End: last,
        }[event.key]
        if (target === undefined) return
        event.preventDefault()
        buttons.current[target]?.focus()
      }}
    >
      {TOOLS.map((t, i) => {
        const unavailable = t.tool === 'floorOpening' && !canCut
        return (
          <button
            key={t.tool}
            ref={(element) => {
              buttons.current[i] = element
            }}
            type="button"
            tabIndex={i === current ? 0 : -1}
            aria-pressed={tool === t.tool}
            aria-keyshortcuts={t.key}
            aria-label={'label' in t ? t.label : undefined}
            aria-disabled={unavailable || undefined}
            onClick={() => store.getState().setTool(t.tool)}
            title={
              unavailable
                ? 'The lowest floor has nothing below to open onto: pick or add a floor above'
                : `${t.title} (${t.key})`
            }
          >
            <span aria-hidden="true">{t.icon}</span>
            <span className="tool-name">{t.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export function PropertiesPanel({
  open,
  coverageText,
}: {
  open: boolean
  /** The coverage summary line, or '' when nothing broadcasts. */
  coverageText: string
}) {
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const optimizing = useEditor((s) => s.optimizer !== undefined)
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
  const floorOpening =
    only?.kind === 'floorOpening'
      ? floor.floorOpenings?.find((o) => o.id === only.id)
      : undefined

  let details
  if (tool === 'wall' && selection.length === 0) details = <WallToolSection />
  else if (tool === 'accessPoint' && selection.length === 0) {
    details = <AccessPointToolSection />
  } else if ((tool === 'door' || tool === 'window') && selection.length === 0) {
    details = <OpeningToolSection kind={tool} />
  } else if (tool === 'floorOpening' && selection.length === 0) {
    details = <FloorOpeningToolSection />
  } else if (floorOpening) {
    details = <FloorOpeningSection opening={floorOpening} floor={floor} />
  } else if (opening)
    details = <OpeningSection opening={opening} floor={floor} />
  else if (ap) details = <AccessPointSection key={ap.id} ap={ap} />
  else if (wall) details = <WallSection wall={wall} floor={floor} />
  else if (node) details = <CornerSection node={node} floor={floor} />
  else if (selection.length > 1) details = <MultipleSection />
  else
    details = (
      <>
        <PlanSection />
        <FloorSection floor={floor} />
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

      {(optimizing || ap || (tool === 'select' && selection.length === 0)) && (
        <OptimizerSection />
      )}

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
        <CoverageSummary message={coverageText} />
        <p className="hint">
          Predictions come from a simplified model.{' '}
          <a href={MODEL_URL}>How it works and its limits</a>
        </p>
      </section>
    </aside>
  )
}

/**
 * The share of the floor inside the walls that reaches the plan's target,
 * for the band on show (#43).
 */
function CoverageSummary({ message }: { message: string }) {
  const store = useEditorStore()
  const target = useEditor((s) => s.plan.coverageTarget ?? DEFAULT_TARGET)
  const id = useId()

  return (
    <div className="coverage-summary">
      <div className="field">
        <label htmlFor={id}>Coverage target</label>
        <select
          id={id}
          value={target}
          onChange={(event) =>
            store
              .getState()
              .setCoverageTarget(event.target.value as CoverageTarget)
          }
        >
          {COVERAGE_TARGETS.map((t) => {
            const q = targetBand(t)
            return (
              <option key={t} value={t}>
                {`${q.label}: ${q.meaning.toLowerCase()}`}
              </option>
            )
          })}
        </select>
      </div>
      {/* Announced from the status bar, where it is always visible (D37). */}
      <p className="coverage-share">{message}</p>
    </div>
  )
}

/**
 * The placement optimizer (D44, D45, D46): buttons to search, then progress
 * and Cancel, then the suggestion with Apply and Dismiss. The canvas shows
 * the suggested spots and the heatmap shows coverage with them applied.
 */
function OptimizerSection() {
  const store = useEditorStore()
  const optimizer = useOptimizer()
  const state = useEditor((s) => s.optimizer)
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const band = useEditor((s) => s.band)
  const selection = useEditor((s) => s.selection)
  const units = useEditor((s) => s.units)
  const goal = useEditor((s) => s.coverageGoal)
  const goalId = useId()

  // Keep focus in the section as its buttons come and go.
  const focusInside = useRef(false)
  const primary = useRef<HTMLButtonElement>(null)
  const status = state?.status
  useEffect(() => {
    const active = document.activeElement
    if (focusInside.current && (!active || active === document.body)) {
      primary.current?.focus()
    }
  }, [status])

  const best = planSearch(plan, floorId, band, selection, 'best')!
  const oneMore = planSearch(plan, floorId, band, selection, 'one-more')
  const howMany = planSearch(plan, floorId, band, selection, 'how-many', goal)
  let statusText = ''
  let body
  if (state?.status === 'searching') {
    statusText = `Searching for ${state.what}…`
    body = (
      <>
        <progress
          className="optimizer-progress"
          value={state.fraction}
          max={1}
          aria-label="Search progress"
          aria-valuetext={`${Math.round(state.fraction * 100)}%`}
        />
        <div className="actions">
          <button
            ref={primary}
            type="button"
            onClick={() => optimizer.cancel()}
          >
            Cancel
          </button>
        </div>
      </>
    )
  } else if (state?.status === 'suggestion') {
    statusText = suggestionSummary(state.suggestion, plan.coverageTarget, units)
    body = (
      <div className="actions">
        <button
          ref={primary}
          type="button"
          className="primary"
          onClick={() => store.getState().applySuggestion()}
        >
          Apply
        </button>
        <button type="button" onClick={() => optimizer.cancel()}>
          Dismiss
        </button>
      </div>
    )
  } else {
    if (state?.status === 'message') statusText = state.text
    body = (
      <>
        {best.kind === 'unavailable' && state?.status !== 'message' && (
          <p className="hint">{best.reason}</p>
        )}
        <div className="actions">
          {best.kind === 'ready' && (
            <button
              ref={primary}
              type="button"
              onClick={() => optimizer.start('best')}
            >
              {best.label}
            </button>
          )}
          {oneMore?.kind === 'ready' && (
            <button
              ref={best.kind === 'ready' ? undefined : primary}
              type="button"
              onClick={() => optimizer.start('one-more')}
            >
              {oneMore.label}
            </button>
          )}
        </div>
        {howMany?.kind === 'ready' && (
          <div className="how-many">
            <div className="field">
              <label htmlFor={goalId}>Coverage goal</label>
              <select
                id={goalId}
                value={goal}
                onChange={(event) =>
                  store
                    .getState()
                    .setCoverageGoal(Number(event.target.value) as CoverageGoal)
                }
              >
                {COVERAGE_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {`${goalText(g)} of the floor`}
                  </option>
                ))}
              </select>
            </div>
            <div className="actions">
              <button type="button" onClick={() => optimizer.start('how-many')}>
                {howMany.label}
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <section
      className="optimizer"
      onFocus={() => {
        focusInside.current = true
      }}
      onBlur={(event) => {
        // Losing focus to a removed button keeps it; leaving the section doesn't.
        if (event.relatedTarget) focusInside.current = false
      }}
    >
      <h2>Suggest a spot</h2>
      <p className="optimizer-status" role="status">
        {statusText}
      </p>
      {body}
      <p className="hint">
        Maximises the share of the floor at the coverage target on the band on
        show. “How many” adds up to {MAX_ADDED} access points, as few as reach
        the goal. Locked access points stay put, and a new one copies the first
        one’s bands, power and height. It assumes a good link back to the
        router: mesh backhaul isn’t modelled.
      </p>
    </section>
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
  coverageText,
  saveStatus,
}: {
  coverage: Coverage | undefined
  /** The coverage summary line, or '' when nothing broadcasts. */
  coverageText: string
  saveStatus: SaveStatus
}) {
  const store = useEditorStore()
  const inGesture = useEditor((s) => s.gesture !== undefined)
  const [announced, setAnnounced] = useState(coverageText)
  const next = settledAnnouncement(announced, coverageText, inGesture)
  if (next !== announced) setAnnounced(next)
  const pointer = useEditor((s) => s.pointer)
  const notice = useEditor((s) => s.notice)
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
      {/* Always visible, so the answer is never below the fold (D37). The
          live region beside it stays quiet until a drag ends. */}
      <p className="coverage-status" aria-hidden="true">
        {coverageText}
      </p>
      <p className="visually-hidden coverage-announcement" role="status">
        {announced}
      </p>
      {/* Not a live region: it changes with every pointer move. */}
      <p className="readout">
        {pointer
          ? `${formatLength(pointer.x, units)}, ${formatLength(pointer.y, units)}`
          : 'Point at the plan'}
        {signal !== undefined &&
          ` · ${signal.toFixed(0)} dBm · ${quality?.label ?? 'No signal'}`}
        {tracing && (
          <span className="tracing-note"> · Heatmap hidden while tracing</span>
        )}
      </p>
      {/* Rare and short, so it's announced (D43). */}
      <p className="status-notice" role="status">
        {notice}
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
          Snaps to corners, walls, the floor below, 15° steps and the grid. Hold
          Alt to place freely.
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

function AccessPointToolSection() {
  const units = useEditor((s) => s.units)
  return (
    <section>
      <h2>Access point tool</h2>
      <p className="kind">Click the plan to add an access point</p>
      <ul className="hint tips">
        <li>
          New access points broadcast on 2.4, 5 and 6 GHz at typical power,
          mounted {formatLength(NEW_ACCESS_POINT_HEIGHT_M, units)} above the
          floor; change them after placing.
        </li>
        <li>Esc returns to Select.</li>
      </ul>
    </section>
  )
}

function AccessPointSection({ ap }: { ap: AccessPoint }) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const floorHeight = useEditor(
    (s) => s.plan.floors.find((f) => f.id === ap.floorId)?.heightM,
  )
  const edit = (label: string, change: (plan: Draft<Plan>) => void) =>
    store.getState().edit(label, change)
  const target = (plan: Draft<Plan>) =>
    plan.accessPoints.find((a) => a.id === ap.id)

  return (
    <section>
      <h2>{ap.name}</h2>
      <p className="kind">Access point</p>
      <TextField
        label="Name"
        value={ap.name}
        maxLength={100}
        onCommit={(name) => {
          const trimmed = name.trim()
          if (!trimmed || trimmed === ap.name) return
          edit(`Rename ${ap.name}`, (plan) => {
            const a = target(plan)
            if (a) a.name = trimmed
          })
        }}
      />
      <LengthField
        label="Mounted at"
        metres={ap.heightM}
        units={units}
        min={0}
        max={floorHeight}
        onCommit={(metres) =>
          edit(`Change ${ap.name} height`, (plan) => {
            const a = target(plan)
            if (a) a.heightM = metres
          })
        }
      />
      <dl>
        <dt>Position</dt>
        <dd>
          {formatLength(ap.x, units)}, {formatLength(ap.y, units)}
        </dd>
      </dl>
      <label className="check-field">
        <input
          type="checkbox"
          checked={ap.locked === true}
          onChange={(event) => {
            const on = event.target.checked
            edit(`${on ? 'Lock' : 'Unlock'} ${ap.name}`, (plan) => {
              const a = target(plan)
              if (!a) return
              if (on) a.locked = true
              else delete a.locked
            })
          }}
        />
        Locked (stays where it is)
      </label>
      <fieldset className="radios">
        <legend>Bands</legend>
        {BANDS.map((band) => {
          const radio = ap.radios.find((r) => r.band === band)
          const last = radio !== undefined && ap.radios.length === 1
          return (
            <div key={band} className="radio-row">
              <label
                title={
                  last ? 'An access point needs at least one band' : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={radio !== undefined}
                  disabled={last}
                  onChange={(event) => {
                    const on = event.target.checked
                    edit(
                      `Turn ${BAND_LABELS[band]} ${on ? 'on' : 'off'}`,
                      (plan) => {
                        setRadioOn(plan, ap.id, band, on)
                      },
                    )
                  }}
                />
                {BAND_LABELS[band]}
              </label>
              {radio && (
                <PowerField
                  band={band}
                  dbm={radio.txPowerDbm}
                  onCommit={(dbm) =>
                    edit(`Change ${BAND_LABELS[band]} power`, (plan) => {
                      setRadioPower(plan, ap.id, band, dbm)
                    })
                  }
                />
              )}
            </div>
          )
        })}
      </fieldset>
      <p className="hint">
        Power is EIRP, antenna gain included.{' '}
        {ap.locked
          ? 'Locked, so it can’t be moved; untick Locked to move it.'
          : 'Drag the access point, or use the arrow keys (Shift for bigger steps).'}
      </p>
      <div className="actions">
        <DeleteButton />
      </div>
    </section>
  )
}

/**
 * A radio's EIRP in dBm. Empty means the band's default; above the FCC limit
 * a note says so, but the value is kept (D25).
 */
function PowerField({
  band,
  dbm,
  onCommit,
}: {
  band: Band
  dbm: number | undefined
  onCommit: (dbm: number | undefined) => void
}) {
  const profile = BAND_PROFILES[band]
  const [draft, setDraft] = useState<string>()
  const [invalid, setInvalid] = useState(false)
  const id = useId()
  const noteId = useId()
  const current = dbm === undefined ? '' : String(dbm)
  const text = draft ?? current

  const reset = () => {
    setDraft(undefined)
    setInvalid(false)
  }
  const commit = () => {
    if (draft === undefined || draft.trim() === current) return reset()
    if (draft.trim() === '') {
      reset()
      onCommit(undefined)
      return
    }
    const value = Number(draft.trim().replace(',', '.'))
    if (
      !Number.isFinite(value) ||
      value < EIRP_RANGE_DBM.min ||
      value > EIRP_RANGE_DBM.max
    ) {
      setInvalid(true)
      return
    }
    reset()
    onCommit(value)
  }
  const shown = invalid ? undefined : draft === undefined ? dbm : Number(draft)
  const overLimit =
    shown !== undefined && Number.isFinite(shown) && shown > profile.maxEirpDbm

  return (
    <div className="field power-field">
      <label htmlFor={id}>{BAND_LABELS[band]} power (dBm EIRP)</label>
      <input
        id={id}
        value={text}
        placeholder={`${profile.defaultTxPowerDbm} (typical)`}
        aria-invalid={invalid}
        aria-describedby={overLimit ? noteId : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
        }}
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
          Use a number from {EIRP_RANGE_DBM.min} to {EIRP_RANGE_DBM.max}, or
          leave it empty for the typical {profile.defaultTxPowerDbm} dBm.
        </p>
      )}
      {overLimit && (
        <p id={noteId} className="field-note">
          Above the legal limit in the US. {profile.maxEirpNote}
        </p>
      )}
    </div>
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
      {floor?.walls.length === 0 && (
        <p className="hint start-hint">
          To start, pick <strong>Wall</strong> (W) and click to place each
          corner; click the first corner again to close a room. Drag an access
          point to move it.
        </p>
      )}
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

/** Floor-to-ceiling heights the panel accepts, in metres. */
const FLOOR_HEIGHT_RANGE_M = { min: 1.5, max: 10 } as const

/** Elevations the panel accepts, in metres: a deep basement to a tall tower. */
const ELEVATION_RANGE_M = { min: -30, max: 300 } as const

const FLOOR_MATERIAL_LABELS: Record<FloorMaterial, string> = {
  'timber-joist': 'Timber joists (wood-framed)',
  'concrete-slab': 'Concrete slab',
}

/** The floor on show: its name, place in the stack and construction (D52). */
function FloorSection({ floor }: { floor: Floor }) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const floors = useEditor((s) => s.plan.floors)
  const constructionId = useId()
  const stack = stackedFloors(floors)
  const index = stack.findIndex((f) => f.id === floor.id)
  const below = stack[index - 1]
  const name = floor.name || 'Unnamed floor'
  const edit = (label: string, change: (target: Draft<Floor>) => void) =>
    store.getState().edit(label, (plan) => {
      const target = plan.floors.find((f) => f.id === floor.id)
      if (target) change(target)
    })

  return (
    <section aria-label="Floor">
      <h2>{name}</h2>
      <p className="kind">Floor</p>
      <TextField
        label="Floor name"
        value={floor.name}
        maxLength={100}
        onCommit={(value) => {
          const trimmed = value.trim()
          if (!trimmed || trimmed === floor.name) return
          edit(`Rename ${name}`, (f) => {
            f.name = trimmed
          })
        }}
      />
      <LengthField
        label="Elevation"
        metres={floor.elevationM}
        units={units}
        signed
        min={ELEVATION_RANGE_M.min}
        max={ELEVATION_RANGE_M.max}
        onCommit={(elevationM) =>
          edit(`Change ${name} elevation`, (f) => {
            f.elevationM = elevationM
          })
        }
      />
      <p className="hint">
        Height of the floor’s surface; negative for a basement.
      </p>
      <LengthField
        label="Floor to ceiling"
        metres={floor.heightM}
        units={units}
        min={FLOOR_HEIGHT_RANGE_M.min}
        max={FLOOR_HEIGHT_RANGE_M.max}
        onCommit={(heightM) =>
          edit(`Change ${name} height`, (f) => {
            f.heightM = heightM
          })
        }
      />
      <div className="field">
        <label htmlFor={constructionId}>Floor construction</label>
        <select
          id={constructionId}
          value={floor.material ?? DEFAULT_FLOOR_MATERIAL}
          onChange={(event) => {
            const material = event.target.value as FloorMaterial
            edit(`Change ${name} construction`, (f) => {
              f.material = material
            })
          }}
        >
          {FLOOR_MATERIALS.map((m) => (
            <option key={m} value={m}>
              {FLOOR_MATERIAL_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        {below
          ? `The floor under ${name}, which signal crosses to and from ${below.name || 'the floor below'}.`
          : `Nothing is below ${name}, so its construction doesn’t change the signal.`}
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={index === stack.length - 1}
          onClick={() => store.getState().moveFloor(floor.id, 'up')}
        >
          Move up
        </button>
        <button
          type="button"
          disabled={index === 0}
          onClick={() => store.getState().moveFloor(floor.id, 'down')}
        >
          Move down
        </button>
        <button
          type="button"
          className="danger"
          disabled={floors.length <= 1}
          title={
            floors.length <= 1
              ? 'A plan needs at least one floor'
              : `Delete ${name} with its walls and access points`
          }
          onClick={() => store.getState().deleteFloor(floor.id)}
        >
          Delete floor
        </button>
      </div>
    </section>
  )
}

/** Deletes everything selected. */
function DeleteButton() {
  const store = useEditorStore()
  const selection = useEditor((s) => s.selection)
  return (
    <button
      type="button"
      className="danger"
      disabled={selection.length === 0}
      title="Delete (Delete key)"
      onClick={() => {
        const state = store.getState()
        state.edit(
          `Delete ${describeSelection(selection)}`,
          deleteRecipe(state.floorId, selection),
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
  min = MIN_WALL_LENGTH_M,
  max,
  signed = false,
  onCommit,
}: {
  label: string
  metres: number
  units: Units
  /** Smallest value accepted, in metres; a wall's minimum length by default. */
  min?: number
  max?: number | undefined
  /** Whether a leading minus sign is allowed, as for an elevation. */
  signed?: boolean
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
    const value = (signed ? parseSignedLength : parseLength)(draft, units)
    if (
      value === undefined ||
      value < min ||
      (max !== undefined && value > max)
    ) {
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
          {max !== undefined
            ? `Use ${formatLength(min, units)} to ${formatLength(max, units)}`
            : units === 'metric'
              ? 'Try 3.5 or 350 cm'
              : `Try 12'6" or 12.5`}
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

function FloorOpeningToolSection() {
  return (
    <section>
      <h2>Floor opening tool</h2>
      <p className="kind">
        Click to place the corners of a stairwell or atrium
      </p>
      <ul className="hint tips">
        <li>
          Signal through it crosses no floor between this floor and the one
          below, and its area isn't counted as floor.
        </li>
        <li>
          Click the first corner, double-click or press Enter to close it; Esc
          drops it.
        </li>
        <li>
          Snaps to corners, walls, the floor below, 15° steps and the grid. Hold
          Alt to place freely.
        </li>
        <li>{MOD_KEY}Z steps back one corner.</li>
      </ul>
    </section>
  )
}

function FloorOpeningSection({
  opening,
  floor,
}: {
  opening: FloorOpening
  floor: Floor
}) {
  const units = useEditor((s) => s.units)
  const lowest = useEditor((s) => !canCutFloor(s.plan, floor.id))
  return (
    <section>
      <h2>Floor opening</h2>
      <p className="kind">Stairwell or atrium</p>
      <dl>
        <dt>Area</dt>
        <dd>{formatArea(polygonArea(opening.points), units)}</dd>
        <dt>Corners</dt>
        <dd>{opening.points.length}</dd>
      </dl>
      <p className="hint">
        {lowest
          ? "Nothing is below the lowest floor, so it only leaves its area out of the floor's."
          : "Signal through it crosses no floor between this floor and the one below, and its area isn't counted as floor."}{' '}
        Drag it to move it, or drag its corners.
      </p>
      <div className="actions">
        <DeleteButton />
      </div>
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
  maxLength = 200,
  onCommit,
}: {
  label: string
  value: string
  maxLength?: number
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
        maxLength={maxLength}
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
