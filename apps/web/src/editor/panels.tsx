import {
  availableChannels,
  BAND_PROFILES,
  DEFAULT_OVERLAP_MARGIN_DB,
  DEFAULT_ROAM_THRESHOLD_DBM,
  viewSettings,
  channelWidths,
  MAX_ADDED,
  MIN_LOCATE_SPOTS,
  radioChannelIssue,
  radioTuning,
  summariseErrors,
  worstSpots,
  REGION_RULES,
  regionBand,
  type ChannelIssue,
  type Coverage,
} from '@signalplan/engine'
import {
  addNeighbourNetwork,
  addSurveyReading,
  forgetIgnoredBssids,
  bssidOwner,
  deleteSurveyReading,
  parseBssids,
  setRadioBssids,
  setReadingDbm,
  setReadingSource,
  setSurveyNote,
  SURVEY_READING_RANGE_DBM,
  surveySpotName,
  type SurveySpot,
  BANDS,
  COVERAGE_TARGETS,
  deleteNeighbourNetwork,
  NEIGHBOUR_STRENGTH_RANGE_DBM,
  renameNeighbourNetwork,
  setNeighbourBand,
  setNeighbourChannel,
  setNeighbourLocation,
  setNeighbourStrength,
  setNeighbourWidth,
  type NeighbourNetwork,
  DEFAULT_REGION,
  REGIONS,
  type Region,
  DEFAULT_FLOOR_MATERIAL,
  EIRP_RANGE_DBM,
  FLOOR_MATERIALS,
  OVERLAP_MARGIN_RANGE_DB,
  ROAM_THRESHOLD_RANGE_DBM,
  MIN_WALL_LENGTH_M,
  NEW_ACCESS_POINT_HEIGHT_M,
  polygonArea,
  setRadioChannel,
  setRadioOn,
  setRadioPower,
  setRadioWidth,
  type ChannelWidth,
  type Plan,
  type Radio,
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
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_TARGET, qualityOf, targetBand } from '../quality.ts'
import {
  EDGE_KEY_CSS,
  HATCH_KEY_CSS,
  MAP_KINDS,
  MAP_LABELS,
  mapLegend,
  rgbCss,
  type MapData,
  type MapKind,
  type Swatch,
} from '../mapView.ts'
import { bandSummary, channelLabel, radioReason } from './channelPlan.ts'
import { zoomAt } from './camera.ts'
import { regionPlace } from './region.ts'
import { BAND_LABELS, settledAnnouncement } from './coverageText.ts'
import { useEditor, useEditorStore } from './context.ts'
import {
  deleteRecipe,
  describeSelection,
  onlySurveySpots,
} from './selectTool.ts'
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
  suggestionFloorLines,
  suggestionSummary,
  areaWord,
  type CoverageGoal,
} from './optimizer.ts'
import { useOptimizer } from './optimizerContext.ts'
import { useCalibrator } from './calibratorContext.ts'
import {
  appliedFits,
  calibratedNote,
  errorChange,
  fitRows,
  improves,
  readinessLines,
} from './modelCalibration.ts'
import {
  checkBand,
  describeNeighbourLocation,
  describePositionCheck,
  formatRadius,
  locateNeighbour,
  neighbourSpotCount,
  toNeighbourLocation,
} from './locate.ts'
import { useScan } from './scanContext.ts'
import { keyForTool } from './shortcuts.ts'
import { ShortcutsHelp } from './ShortcutsHelp.tsx'
import { useSurveyImport } from './surveyImportContext.ts'
import {
  errorLegendRows,
  formatDbm,
  formatErrorDb,
  useSurveyErrors,
  type SurveyErrors,
} from './surveyErrors.ts'

const MODEL_URL = 'https://github.com/NC4321/SignalPlan/blob/main/docs/MODEL.md'
const FLOORPLAN_IMPORT_URL =
  'https://github.com/NC4321/SignalPlan/blob/main/docs/FLOORPLAN.md#importing-survey-readings'

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
  const show = useEditor((s) => s.show)
  const showId = useId()
  const showHeatmap = useEditor((s) => s.showHeatmap)
  const view = useEditor((s) => s.view)

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
        label="View"
        name="view"
        value={view}
        options={[
          { value: '2d', label: '2D' },
          { value: '3d', label: '3D' },
        ]}
        onChange={(v) => store.getState().setView(v)}
      />

      <Segmented
        label="Band"
        name="band"
        value={band}
        options={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
        onChange={(b) => store.getState().setBand(b)}
      />

      <div className="toggle show-menu">
        <label htmlFor={showId}>Show</label>
        <select
          id={showId}
          value={show}
          onChange={(event) =>
            store.getState().setShow(event.target.value as MapKind)
          }
        >
          {MAP_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {MAP_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

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

      <ShortcutsHelp />

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
    key: keyForTool('select'),
    title: 'Select and move',
  },
  {
    tool: 'wall',
    name: 'Wall',
    icon: '▭',
    key: keyForTool('wall'),
    title: 'Draw walls',
  },
  {
    tool: 'door',
    name: 'Door',
    icon: '⌷',
    key: keyForTool('door'),
    title: 'Add doors',
  },
  {
    tool: 'window',
    name: 'Window',
    icon: '▤',
    key: keyForTool('window'),
    title: 'Add windows',
  },
  {
    tool: 'floorOpening',
    name: 'Opening',
    label: 'Floor opening',
    icon: '▨',
    key: keyForTool('floorOpening'),
    title: 'Add stairwells and atriums: openings in the floor',
  },
  {
    tool: 'accessPoint',
    name: 'AP',
    label: 'Access point',
    icon: '◉',
    key: keyForTool('accessPoint'),
    title: 'Add access points',
  },
  {
    tool: 'survey',
    name: 'Survey',
    icon: '⌖',
    key: keyForTool('survey'),
    title: 'Record signal readings at spots',
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
  // The 3D view is for looking; editing is in 2D (D57).
  const in3d = useEditor((s) => s.view === '3d')
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
        const unavailable = in3d || (t.tool === 'floorOpening' && !canCut)
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
            onClick={() => {
              if (!in3d) store.getState().setTool(t.tool)
            }}
            title={
              in3d
                ? 'Switch to 2D to edit'
                : unavailable
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
  map,
}: {
  open: boolean
  /** The coverage summary line, or '' when nothing broadcasts. */
  coverageText: string
  /** The map on show, for its legend (D64). */
  map: MapData | undefined
}) {
  const plan = useEditor((s) => s.plan)
  const floorId = useEditor((s) => s.floorId)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const optimizing = useEditor((s) => s.optimizer !== undefined)
  const calibrating = useEditor((s) => s.modelCalibration !== undefined)
  const in3d = useEditor((s) => s.view === '3d')
  const floor = plan.floors.find((f) => f.id === floorId)!
  const calibrationNote = calibratedNote(plan)

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
  const surveySpot =
    only?.kind === 'surveySpot'
      ? floor.surveySpots?.find((s) => s.id === only.id)
      : undefined

  let details
  // Whether the details already show Calibrate, with the survey list (D76).
  let calibrateShown = false
  if (in3d) details = <View3DSection />
  else if (tool === 'wall' && selection.length === 0) {
    details = <WallToolSection />
  } else if (tool === 'accessPoint' && selection.length === 0) {
    details = <AccessPointToolSection />
  } else if ((tool === 'door' || tool === 'window') && selection.length === 0) {
    details = <OpeningToolSection kind={tool} />
  } else if (tool === 'floorOpening' && selection.length === 0) {
    details = <FloorOpeningToolSection />
  } else if (tool === 'survey' && selection.length === 0) {
    details = <SurveyToolSection />
    calibrateShown = true
  } else if (surveySpot) {
    details = <SurveySpotSection key={surveySpot.id} spot={surveySpot} />
  } else if (floorOpening) {
    details = <FloorOpeningSection opening={floorOpening} floor={floor} />
  } else if (opening)
    details = <OpeningSection opening={opening} floor={floor} />
  else if (ap) details = <AccessPointSection key={ap.id} ap={ap} />
  else if (wall) details = <WallSection wall={wall} floor={floor} />
  else if (node) details = <CornerSection node={node} floor={floor} />
  else if (selection.length > 1) details = <MultipleSection />
  else {
    calibrateShown =
      plan.calibration !== undefined ||
      plan.floors.some((f) => (f.surveySpots ?? []).length > 0)
    details = (
      <>
        <PlanSection />
        <FloorSection floor={floor} />
        {floor.background && <TracingSection background={floor.background} />}
      </>
    )
  }

  return (
    <aside
      id="properties"
      className="properties"
      data-open={open || undefined}
      aria-label="Properties"
    >
      {details}

      {!in3d &&
        (optimizing || ap || (tool === 'select' && selection.length === 0)) && (
          <OptimizerSection />
        )}

      {!in3d && calibrating && !calibrateShown && (
        <section>
          <CalibrateSection />
        </section>
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
        <MapLegend map={map} />
        {!in3d && (floor.surveySpots ?? []).length > 0 && <PinLegend />}
        <CoverageSummary message={coverageText} />
        <p className="hint">
          Predictions come from a simplified model.{' '}
          {calibrationNote && `${calibrationNote} `}
          <a href={MODEL_URL}>How it works and its limits</a>
        </p>
      </section>
    </aside>
  )
}

/**
 * The legend for the map on show (D64), with how to read it. The Roaming
 * view's names come from the map itself, so they match its colours, even
 * with a suggestion's access points added.
 */
function MapLegend({ map }: { map: MapData | undefined }) {
  const show = useEditor((s) => s.show)
  const plan = useEditor((s) => s.plan)
  const names = map ? map.accessPointNames : []
  const legend = mapLegend(
    show,
    viewSettings(plan),
    names,
    map ? map.autoChannels : 0,
    map ? map.neighbours : 0,
    map ? map.locatedNeighbours : 0,
  )
  return (
    <>
      <h2>{legend.title}</h2>
      <ul className="legend">
        {legend.rows.map((row, i) => (
          <li key={`${i}-${row.label}`}>
            <LegendSwatch swatch={row.swatch} />
            <span className="legend-label">{row.label}</span>
            <span className="legend-range">{row.detail}</span>
          </li>
        ))}
      </ul>
      {legend.note && <p className="hint legend-note">{legend.note}</p>}
    </>
  )
}

function LegendSwatch({ swatch }: { swatch: Swatch }) {
  switch (swatch.kind) {
    case 'fill':
      return (
        <span className="swatch" style={{ background: rgbCss(swatch.rgb) }} />
      )
    case 'none':
      return <span className="swatch swatch-none" />
    case 'hatch':
      return <span className="swatch" style={{ background: HATCH_KEY_CSS }} />
    case 'edge':
      return <span className="swatch" style={{ background: EDGE_KEY_CSS }} />
  }
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
    statusText = suggestionSummary(
      state.suggestion,
      plan.coverageTarget,
      units,
      plan,
    )
    const floorLines = suggestionFloorLines(state.suggestion, plan)
    body = (
      <>
        {floorLines.length > 0 && (
          <ul className="hint floor-shares" aria-label="By floor">
            {floorLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
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
      </>
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
                    {`${goalText(g)} of the ${areaWord(plan)}`}
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
        {plan.floors.length > 1
          ? 'Maximises the share of the whole home, every floor by its area, at the coverage target on the band on show. Access points move within their own floor; new ones can go on any floor.'
          : 'Maximises the share of the floor at the coverage target on the band on show.'}{' '}
        “How many” adds up to {MAX_ADDED} access points, as few as reach the
        goal. Locked access points stay put, and a new one copies the first
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
  // The 3D view has its own camera buttons (D57).
  const in3d = useEditor((s) => s.view === '3d')
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
      {!in3d && (
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
      )}
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
      <PositionCheckSection ap={ap} />
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
              {radio && (
                <ChannelFields
                  radio={radio}
                  onWidth={(width) =>
                    edit(`Change ${BAND_LABELS[band]} width`, (plan) => {
                      setRadioWidth(plan, ap.id, band, width)
                    })
                  }
                  onChannel={(channel) =>
                    edit(`Change ${BAND_LABELS[band]} channel`, (plan) => {
                      setRadioChannel(plan, ap.id, band, channel)
                    })
                  }
                />
              )}
              {radio && (
                <BssidField
                  ap={ap}
                  radio={radio}
                  onCommit={(bssids) =>
                    store.getState().edit(
                      `Change ${BAND_LABELS[band]} BSSIDs`,
                      (plan) => {
                        setRadioBssids(plan, ap.id, band, bssids)
                      },
                      // BSSIDs don't change coverage (D71).
                      { keepOptimizer: true },
                    )
                  }
                />
              )}
            </div>
          )
        })}
      </fieldset>
      <p className="hint">
        Power is EIRP, antenna gain included. Pick a width, then a channel; a
        channel you pick stays fixed, and Auto leaves it open. Each network name
        a radio broadcasts has its own BSSID, which a Wi-Fi scanner shows;
        separate them with commas.{' '}
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
 * A radio's EIRP in dBm. Empty means the band's default; above the plan
 * region's limit a note says so, but the value is kept (D25, D62).
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
  const region = useEditor((s) => s.plan.region)
  const limits = regionBand(region, band)
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
    shown !== undefined && Number.isFinite(shown) && shown > limits.maxEirpDbm

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
          Above the legal limit in {regionPlace(region)}. {limits.eirpNote}
        </p>
      )}
    </div>
  )
}

/** How a channel or width menu labels an option that the rules don't allow. */
const ISSUE_SUFFIX: Record<ChannelIssue, string> = {
  region: 'not allowed',
  dfs: 'DFS, off',
}

/**
 * A radio's width, then its channel at that width, limited to what the plan's
 * region and DFS setting allow (D61, D63). A hand-set value the rules no
 * longer allow stays, marked, with a note, rather than being changed.
 */
function ChannelFields({
  radio,
  onWidth,
  onChannel,
}: {
  radio: Radio
  onWidth: (width: ChannelWidth | undefined) => void
  onChannel: (channel: number | undefined) => void
}) {
  const region = useEditor((s) => s.plan.region)
  const allowDfs = useEditor((s) => s.plan.allowDfs)
  const widthId = useId()
  const channelId = useId()
  const noteId = useId()
  const { band, channel } = radio
  const width = radio.channelWidthMHz
  const widths = channelWidths(region, band)
  const channels =
    width === undefined ? [] : availableChannels(region, band, width, allowDfs)
  const issue = radioChannelIssue(region, allowDfs, radio)
  const widthAllowed = width === undefined || widths.includes(width)
  const channelListed =
    channel === undefined || channels.some((c) => c.channel === channel)

  return (
    <div className="channel-fields">
      <div className="field">
        <label htmlFor={widthId}>
          <span className="visually-hidden">{BAND_LABELS[band]} </span>
          Width
        </label>
        <select
          id={widthId}
          value={width ?? ''}
          aria-invalid={!widthAllowed}
          aria-describedby={issue ? noteId : undefined}
          onChange={(event) => {
            const value = event.target.value
            onWidth(value === '' ? undefined : (Number(value) as ChannelWidth))
          }}
        >
          <option value="">Auto</option>
          {widths.map((w) => (
            <option key={w} value={w}>
              {w} MHz
            </option>
          ))}
          {!widthAllowed && (
            <option value={width}>
              {width} MHz ({ISSUE_SUFFIX.region})
            </option>
          )}
        </select>
      </div>
      <div className="field">
        <label htmlFor={channelId}>
          <span className="visually-hidden">{BAND_LABELS[band]} </span>
          Channel
        </label>
        <select
          id={channelId}
          value={channel ?? ''}
          disabled={width === undefined}

          aria-invalid={issue !== undefined && channel !== undefined}
          aria-describedby={issue ? noteId : undefined}
          onChange={(event) => {
            const value = event.target.value
            onChannel(value === '' ? undefined : Number(value))
          }}
        >
          <option value="">Auto</option>
          {channels.map((c) => (
            <option key={c.channel} value={c.channel}>
              {c.channel} ({c.centreMHz} MHz{c.dfs ? ', DFS' : ''})
            </option>
          ))}
          {!channelListed && (
            <option value={channel}>
              {channel} ({ISSUE_SUFFIX[issue ?? 'region']})
            </option>
          )}
        </select>
      </div>
      {issue && (
        <p id={noteId} className="field-note field-warning">
          {channelIssueText(radio, issue, region)}
        </p>
      )}
    </div>
  )
}

/** Why a radio's width or channel isn't allowed, as a sentence (D63). */
function channelIssueText(
  radio: Radio,
  issue: ChannelIssue,
  region: Region | undefined,
): string {
  const place = regionPlace(region)
  const band = BAND_LABELS[radio.band]
  if (issue === 'dfs') {
    return `Channel ${radio.channel} is a DFS channel, and this plan doesn’t allow DFS. Pick another, or allow DFS with no access point selected.`
  }
  const widths = channelWidths(region, radio.band)
  if (
    radio.channelWidthMHz !== undefined &&
    !widths.includes(radio.channelWidthMHz)
  ) {
    return `${radio.channelWidthMHz} MHz isn’t allowed on ${band} in ${place}. Pick another width.`
  }
  return `Channel ${radio.channel} at ${radio.channelWidthMHz} MHz isn’t allowed on ${band} in ${place}. Pick another.`
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

/**
 * An empty list or section (D92): one plain sentence on what to do next, with
 * the button that does it, in the hint style.
 */
function EmptyState({
  children,
  action,
  onAction,
  className,
}: {
  children: ReactNode
  action: string
  onAction: () => void
  className?: string
}) {
  return (
    <div className={className ? `empty-state ${className}` : 'empty-state'}>
      <p className="hint">{children}</p>
      <button type="button" onClick={onAction}>
        {action}
      </button>
    </div>
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
        <EmptyState
          className="start-hint"
          action="Draw your first wall"
          onAction={() => store.getState().setTool('wall')}
        >
          No walls on this floor yet. Pick <strong>Wall</strong> (W) and click
          each corner; click the first again to close a room.
          {plan.accessPoints.some((a) => a.floorId === floorId) &&
            ' Drag an access point to move it.'}
        </EmptyState>
      )}
      <RegionFields />
      <NeighbourFields />
      {plan.floors.some((f) => (f.surveySpots ?? []).length > 0) ? (
        <>
          <SurveyList />
          <p className="hint">Add more with the Survey tool (S).</p>
        </>
      ) : (
        <>
          <h3>Survey spots</h3>
          <EmptyState
            className="survey-empty"
            action="Add survey spots"
            onAction={() => store.getState().setTool('survey')}
          >
            No survey spots yet. Measure signal in a few rooms to check the
            model against your home.
          </EmptyState>
          {/* Reset stays in reach after the spots are gone (D76). */}
          {plan.calibration && <CalibrateSection />}
        </>
      )}
      <ViewSettingsFields />
      <h3>Access points</h3>
      {!plan.accessPoints.some((a) => a.floorId === floorId) && (
        <EmptyState
          className="access-points-empty"
          action="Place an access point"
          onAction={() => store.getState().setTool('accessPoint')}
        >
          No access points on this floor yet. Place one where your router or
          access point is.
        </EmptyState>
      )}
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

/** Whose channel rules the plan follows, and whether DFS is allowed (D61). */
function RegionFields() {
  const store = useEditorStore()
  const region = useEditor((s) => s.plan.region ?? DEFAULT_REGION)
  const allowDfs = useEditor((s) => s.plan.allowDfs ?? false)
  const regionId = useId()
  const dfsHintId = useId()
  return (
    <>
      <h3>Channels</h3>
      <div className="field">
        <label htmlFor={regionId}>Region</label>
        <select
          id={regionId}
          value={region}
          onChange={(event) =>
            store.getState().setRegion(event.target.value as Region)
          }
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {REGION_RULES[r].name}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        Only US and EU rules for now; your country’s channels may differ.
      </p>
      <label className="check-field">
        <input
          type="checkbox"
          checked={allowDfs}
          aria-describedby={dfsHintId}
          onChange={(event) =>
            store.getState().setAllowDfs(event.target.checked)
          }
        />
        Allow DFS channels
      </label>
      <p id={dfsHintId} className="hint">
        DFS channels give 5 GHz more room, but a router must listen for radar
        before using one and move off it if it hears any.
      </p>
      <ChannelIssueList />
      <ChannelPlanSection />
    </>
  )
}

/**
 * The channel planner (D68): a button that suggests channels for every band,
 * then the suggestion band by band with a reason per radio, and Apply or
 * Dismiss. The map shows the plan with it applied while it waits.
 */
function ChannelPlanSection() {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const suggestion = useEditor((s) => s.channelPlan)
  const primary = useRef<HTMLButtonElement>(null)
  const focusInside = useRef(false)
  useEffect(() => {
    const active = document.activeElement
    if (focusInside.current && (!active || active === document.body)) {
      primary.current?.focus()
    }
  }, [suggestion])
  const name = (id: string) =>
    plan.accessPoints.find((ap) => ap.id === id)?.name ?? id
  return (
    <div
      className="channel-plan"
      onFocus={() => (focusInside.current = true)}
      onBlur={() => (focusInside.current = false)}
    >
      {!suggestion ? (
        <>
          <div className="actions">
            <button
              ref={primary}
              type="button"
              disabled={plan.accessPoints.length === 0}
              onClick={() => store.getState().planChannels()}
            >
              Plan channels
            </button>
          </div>
          <p className="hint">
            {plan.accessPoints.length === 0
              ? 'Plan channels needs an access point first.'
              : 'Suggests a channel and width for each radio left on Auto, so access points that hear each other don’t share one.'}
          </p>
        </>
      ) : (
        <>
          {suggestion.map((band) => (
            <section
              key={band.band}
              className="channel-plan-band"
              aria-label={`${BAND_LABELS[band.band]} channel plan`}
            >
              <h4>{BAND_LABELS[band.band]}</h4>
              {bandSummary(plan, band).map((line) => (
                <p key={line} className="hint">
                  {line}
                </p>
              ))}
              <ul className="channel-plan-radios">
                {band.radios.map((r) => (
                  <li key={r.accessPointId}>
                    <strong>{name(r.accessPointId)}</strong>:{' '}
                    {channelLabel(band.band, r)}
                    <span className="field-note">
                      {' '}
                      {radioReason(plan, band, r)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="actions">
            <button
              ref={primary}
              type="button"
              className="primary"
              onClick={() => store.getState().applyChannelPlan()}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => store.getState().dismissChannelPlan()}
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Neighbours' networks, typed in by hand as background interference (D61,
 * D67). None of them changes coverage, so edits keep a search or suggestion.
 */
function NeighbourFields() {
  const store = useEditorStore()
  const networks = useEditor((s) => s.plan.neighbourNetworks)
  const region = useEditor((s) => s.plan.region)
  const hintId = useId()
  const edit = (label: string, change: (plan: Draft<Plan>) => void) =>
    store.getState().edit(label, change, { keepOptimizer: true })
  const usualWidth = (band: Band) => radioTuning({ band }, region).widthMHz
  const { openScan } = useScan()
  return (
    <>
      <h3>Neighbours’ networks</h3>
      <p id={hintId} className="hint">
        Networks next door slow yours down when they share its channels. A free
        Wi-Fi analyser app shows each one’s channel, width and signal in dBm; on
        an iPhone, AirPort Utility’s Wi-Fi Scanner does once it’s turned on in
        Settings. Its signal counts everywhere in the home, unless scans at
        three survey spots or more have located it.
      </p>
      {(networks?.length ?? 0) === 0 && (
        <p className="hint">
          No neighbours’ networks yet. Add the ones you can see, and channels
          are planned around them.
        </p>
      )}
      {networks?.map((network, i) => (
        <NeighbourRow
          key={network.id}
          network={network}
          fallbackName={`Network ${i + 1}`}
          usualWidth={usualWidth}
          edit={edit}
        />
      ))}
      <button
        type="button"
        className="add-neighbour"
        aria-describedby={hintId}
        onClick={() =>
          edit('Add neighbour’s network', (plan) => {
            addNeighbourNetwork(plan, '5GHz', usualWidth('5GHz'))
          })
        }
      >
        Add a network
      </button>
      <button type="button" onClick={openScan}>
        Scan your network…
      </button>
    </>
  )
}

function NeighbourRow({
  network,
  fallbackName,
  usualWidth,
  edit,
}: {
  network: NeighbourNetwork
  fallbackName: string
  usualWidth: (band: Band) => ChannelWidth
  edit: (label: string, change: (plan: Draft<Plan>) => void) => void
}) {
  const region = useEditor((s) => s.plan.region)
  const bandId = useId()
  const widthId = useId()
  const channelId = useId()
  const noteId = useId()
  const { id, band, channel } = network
  const width = network.channelWidthMHz
  const name = network.name ?? fallbackName
  const widths = channelWidths(region, band)
  // Next door isn't bound by this plan's DFS setting.
  const channels = availableChannels(region, band, width, true)
  const channelListed =
    channel === undefined || channels.some((c) => c.channel === channel)
  // The band tells apart rows with one name, like a neighbour's 2.4 and
  // 5 GHz networks.
  const label = `${name}, ${BAND_LABELS[band]}`
  const hidden = <span className="visually-hidden">{label} </span>
  return (
    <fieldset className="neighbour">
      <legend>
        <span aria-hidden="true">{name}</span>
        <span className="visually-hidden">{label}</span>
      </legend>
      <TextField
        label={<>{hidden}Name</>}
        value={network.name ?? ''}
        maxLength={100}
        placeholder={fallbackName}
        onCommit={(value) =>
          edit('Rename neighbour’s network', (plan) => {
            renameNeighbourNetwork(plan, id, value)
          })
        }
      />
      <div className="neighbour-fields">
        <div className="field">
          <label htmlFor={bandId}>{hidden}Band</label>
          <select
            id={bandId}
            value={band}
            onChange={(event) => {
              const next = event.target.value as Band
              edit('Change neighbour’s band', (plan) => {
                setNeighbourBand(plan, id, next, usualWidth(next))
              })
            }}
          >
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {BAND_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={widthId}>{hidden}Width</label>
          <select
            id={widthId}
            value={width}
            onChange={(event) => {
              const next = Number(event.target.value) as ChannelWidth
              edit('Change neighbour’s width', (plan) => {
                setNeighbourWidth(plan, id, next)
              })
            }}
          >
            {widths.map((w) => (
              <option key={w} value={w}>
                {w} MHz
              </option>
            ))}
            {!widths.includes(width) && (
              <option value={width}>{width} MHz</option>
            )}
          </select>
        </div>
        <div className="field">
          <label htmlFor={channelId}>{hidden}Channel</label>
          <select
            id={channelId}
            value={channel ?? ''}
            aria-invalid={channel === undefined}
            aria-describedby={channel === undefined ? noteId : undefined}
            onChange={(event) => {
              const value = event.target.value
              edit('Change neighbour’s channel', (plan) => {
                setNeighbourChannel(
                  plan,
                  id,
                  value === '' ? undefined : Number(value),
                )
              })
            }}
          >
            <option value="">Pick one</option>
            {channels.map((c) => (
              <option key={c.channel} value={c.channel}>
                {c.channel} ({c.centreMHz} MHz{c.dfs ? ', DFS' : ''})
              </option>
            ))}
            {!channelListed && <option value={channel}>{channel}</option>}
          </select>
        </div>
        <SettingField
          label={<>{hidden}Signal (dBm)</>}
          value={network.strengthDbm}
          range={NEIGHBOUR_STRENGTH_RANGE_DBM}
          onCommit={(value) => {
            if (value === undefined) return
            edit('Change neighbour’s signal', (plan) => {
              setNeighbourStrength(plan, id, value)
            })
          }}
        />
      </div>
      {channel === undefined && (
        <p id={noteId} className="field-note field-warning">
          Pick a channel to count this network.
        </p>
      )}
      <NeighbourLocationFields network={network} label={label} edit={edit} />
      <button
        type="button"
        className="remove-neighbour"
        onClick={() =>
          edit('Remove neighbour’s network', (plan) => {
            deleteNeighbourNetwork(plan, id)
          })
        }
      >
        Remove<span className="visually-hidden"> {label}</span>
      </button>
    </fieldset>
  )
}

/**
 * Where a scanned neighbour's network is (D84, D85): located from the scans
 * heard at survey spots, or how many more spots it needs. Locating is one
 * edit, so undo takes it back.
 */
function NeighbourLocationFields({
  network,
  label,
  edit,
}: {
  network: NeighbourNetwork
  label: string
  edit: (label: string, change: (plan: Draft<Plan>) => void) => void
}) {
  const plan = useEditor((s) => s.plan)
  const units = useEditor((s) => s.units)
  const store = useEditorStore()
  const { id, location } = network
  if (network.bssid === undefined && !location) return null
  const spots = neighbourSpotCount(plan, network)
  const hidden = <span className="visually-hidden"> {label}</span>
  const locate = () => {
    const found = locateNeighbour(plan, network)
    if (!found) return
    edit('Locate neighbour’s network', (draft) => {
      setNeighbourLocation(draft, id, toNeighbourLocation(found))
    })
    store.setState({
      notice: `${label}: located to within ${formatRadius(found.uncertaintyM, units)}.`,
    })
  }
  return (
    <div className="neighbour-location">
      <p className="field-note">
        {location
          ? describeNeighbourLocation(plan, location, units)
          : spots >= MIN_LOCATE_SPOTS
            ? `Heard by scans at ${spots} spots, enough to locate it.`
            : `Heard by scans at ${spots} of the ${MIN_LOCATE_SPOTS} spots needed to locate it. Scan at more spots with Scan your network.`}
      </p>
      <div className="actions">
        {spots >= MIN_LOCATE_SPOTS && (
          <button type="button" onClick={locate}>
            {location ? 'Locate again' : 'Locate from scans'}
            {hidden}
          </button>
        )}
        {location && (
          <button
            type="button"
            onClick={() =>
              edit('Clear neighbour’s location', (draft) => {
                setNeighbourLocation(draft, id, undefined)
              })
            }
          >
            Clear location{hidden}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Checks where an access point is against its survey readings (D85): the
 * spot they put it at shows on the map with its radius, to move it there
 * with Apply or keep it with Dismiss, like an optimizer suggestion (D44).
 */
function PositionCheckSection({ ap }: { ap: AccessPoint }) {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const units = useEditor((s) => s.units)
  const check = useEditor((s) =>
    s.positionCheck?.apId === ap.id ? s.positionCheck : undefined,
  )
  const band = checkBand(plan, ap.id)
  if (!band && !check) return null
  if (!check) {
    return (
      <div className="position-check">
        <div className="actions">
          <button
            type="button"
            onClick={() => store.getState().checkPosition(ap.id)}
          >
            Check its position
          </button>
        </div>
        <p className="hint">
          Finds where its survey readings on {BAND_LABELS[band!]} put it, for
          when you’re not sure where it is.
        </p>
      </div>
    )
  }
  const { text, agrees } = describePositionCheck(plan, check, units)
  return (
    <div className="position-check" role="status">
      <p className="field-note">{text}</p>
      <div className="actions">
        {!agrees && (
          <button
            type="button"
            className="primary"
            disabled={ap.locked === true}
            onClick={() => store.getState().applyPositionCheck()}
          >
            Move it there
          </button>
        )}
        <button
          type="button"
          onClick={() => store.getState().dismissPositionCheck()}
        >
          {agrees ? 'OK' : 'Dismiss'}
        </button>
      </div>
      {!agrees && ap.locked && (
        <p className="hint">Locked, so it stays; untick Locked to move it.</p>
      )}
    </div>
  )
}

/**
 * The Overlap view's margin and the Roaming view's threshold, saved with the
 * plan so a shared plan shows the same views (D61, D64).
 */
function ViewSettingsFields() {
  const store = useEditorStore()
  const margin = useEditor((s) => s.plan.overlapMarginDb)
  const threshold = useEditor((s) => s.plan.roamThresholdDbm)
  // Neither setting changes a search or suggestion, so they keep it.
  const edit = (label: string, change: (plan: Draft<Plan>) => void) =>
    store.getState().edit(label, change, { keepOptimizer: true })
  return (
    <details className="advanced">
      <summary>Overlap and roaming</summary>
      <SettingField
        label="Overlap margin (dB)"
        value={margin}
        fallback={DEFAULT_OVERLAP_MARGIN_DB}
        range={OVERLAP_MARGIN_RANGE_DB}
        onCommit={(value) =>
          edit('Change overlap margin', (plan) => {
            if (value === undefined) delete plan.overlapMarginDb
            else plan.overlapMarginDb = value
          })
        }
      />
      <SettingField
        label="Roaming threshold (dBm)"
        value={threshold}
        fallback={DEFAULT_ROAM_THRESHOLD_DBM}
        range={ROAM_THRESHOLD_RANGE_DBM}
        onCommit={(value) =>
          edit('Change roaming threshold', (plan) => {
            if (value === undefined) delete plan.roamThresholdDbm
            else plan.roamThresholdDbm = value
          })
        }
      />
      <p className="hint">
        The defaults are Apple’s for iPhone and iPad: they look for another
        access point below −70 dBm, and move to one about 8 dB stronger. Macs
        wait until −75 dBm and need 12 dB.
      </p>
    </details>
  )
}

/**
 * A number saved with the plan, or empty for its default. Out-of-range
 * values are refused with a message, like the power field (D25). Without a
 * `fallback` a value is required, and emptying the field puts it back.
 */
function SettingField({
  label,
  value,
  fallback,
  range,
  onCommit,
}: {
  label: ReactNode
  value: number | undefined
  fallback?: number
  range: { min: number; max: number }
  onCommit: (value: number | undefined) => void
}) {
  const [draft, setDraft] = useState<string>()
  const [invalid, setInvalid] = useState(false)
  const id = useId()
  const current = value === undefined ? '' : String(value)
  const reset = () => {
    setDraft(undefined)
    setInvalid(false)
  }
  const commit = () => {
    if (draft === undefined || draft.trim() === current) return reset()
    if (draft.trim() === '') {
      reset()
      if (fallback !== undefined) onCommit(undefined)
      return
    }
    const next = Number(draft.trim().replace(',', '.').replace('−', '-'))
    if (!Number.isFinite(next) || next < range.min || next > range.max) {
      setInvalid(true)
      return
    }
    reset()
    if (next !== value) onCommit(next)
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft ?? current}
        placeholder={
          fallback === undefined ? undefined : `${fallback} (default)`
        }
        aria-invalid={invalid}
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
          Use a number from {range.min} to {range.max}
          {fallback === undefined
            ? '.'
            : `, or leave it empty for the default ${fallback}.`}
        </p>
      )}
    </div>
  )
}

/**
 * Access points with a width or channel the plan's rules don't allow, say
 * after changing region or turning DFS off, so they're easy to find (D63).
 */
function ChannelIssueList() {
  const store = useEditorStore()
  const plan = useEditor((s) => s.plan)
  const flagged = plan.accessPoints.flatMap((ap) =>
    ap.radios
      .filter((radio) => radioChannelIssue(plan.region, plan.allowDfs, radio))
      .map((radio) => ({ ap, band: radio.band })),
  )
  if (flagged.length === 0) return null
  const floors = plan.floors.length
  return (
    <div className="channel-issues">
      <p className="field-note field-warning">
        {flagged.length === 1
          ? 'One radio has a channel or width these rules don’t allow:'
          : `${flagged.length} radios have a channel or width these rules don’t allow:`}
      </p>
      <ul className="object-list">
        {flagged.map(({ ap, band }) => (
          <li key={`${ap.id}-${band}`}>
            <button
              type="button"
              onClick={() => {
                const state = store.getState()
                state.setFloor(ap.floorId)
                state.select([{ kind: 'accessPoint', id: ap.id }])
              }}
            >
              {ap.name}, {BAND_LABELS[band]}
              {floors > 1 &&
                ` (${plan.floors.find((f) => f.id === ap.floorId)?.name ?? ''})`}
            </button>
          </li>
        ))}
      </ul>
    </div>
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
          { keepOptimizer: onlySurveySpots(selection) },
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

/**
 * The 3D view's settings (D57): which floors show, how far apart, and how
 * tall the walls are. None of them is saved.
 */
function View3DSection() {
  const store = useEditorStore()
  const floors = useEditor((s) => s.plan.floors)
  const settings = useEditor((s) => s.view3d)
  const units = useEditor((s) => s.units)
  const spreadId = useId()
  const topDown = stackedFloors(floors).reverse()
  const set = (change: Partial<typeof settings>) =>
    store.getState().setView3d(change)
  return (
    <section>
      <h2>3D view</h2>
      <p className="kind">For looking around; editing is in 2D</p>
      <fieldset className="view3d-floors">
        <legend>Floors shown</legend>
        {topDown.map((floor) => (
          <label key={floor.id}>
            <input
              type="checkbox"
              checked={!settings.hiddenFloors.includes(floor.id)}
              onChange={(event) =>
                set({
                  hiddenFloors: event.target.checked
                    ? settings.hiddenFloors.filter((id) => id !== floor.id)
                    : [...settings.hiddenFloors, floor.id],
                })
              }
            />
            {floor.name || 'Unnamed floor'}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={spreadId}>Spread floors apart</label>
        <input
          id={spreadId}
          type="range"
          min={0}
          max={6}
          step={0.5}
          value={settings.spreadM}
          aria-valuetext={formatLength(settings.spreadM, units)}
          onChange={(event) => set({ spreadM: Number(event.target.value) })}
        />
        <span className="range-value">
          {formatLength(settings.spreadM, units)}
        </span>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.fullWalls}
          onChange={(event) => set({ fullWalls: event.target.checked })}
        />
        Full-height walls
      </label>
      <ul className="hint tips">
        <li>
          Drag to rotate, scroll or pinch to zoom, right-drag or two fingers to
          move. The buttons do the same from the keyboard.
        </li>
        <li>
          Walls are cut away at 1 m so the heatmap on each floor shows; the
          heatmap is for the band on show.
        </li>
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
  placeholder,
  onCommit,
}: {
  label: ReactNode
  value: string
  maxLength?: number
  placeholder?: string
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
        placeholder={placeholder}
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

function SurveyToolSection() {
  return (
    <section>
      <h2>Survey tool</h2>
      <p className="kind">Click the plan where you measured signal</p>
      <ul className="hint tips">
        <li>
          Then type in each reading: which access point and band it’s from, and
          its signal in dBm.
        </li>
        <li>Drag a pin to move it. Esc returns to Select.</li>
      </ul>
      <FadeHeatmapField />
      <ReadingHint />
      <SurveyList />
    </section>
  )
}

/**
 * Whether the heatmap fades while surveying (D74), so its purples aren't
 * mistaken for the pins'. Not saved.
 */
function FadeHeatmapField() {
  const store = useEditorStore()
  const fade = useEditor((s) => s.fadeHeatmapForSurvey)
  return (
    <label className="check-field">
      <input
        type="checkbox"
        checked={fade}
        onChange={(event) =>
          store.getState().setFadeHeatmapForSurvey(event.target.checked)
        }
      />
      Fade heatmap behind pins
    </label>
  )
}

/** Where to read signal in dBm on a phone (D70, D71). */
function ReadingHint() {
  return (
    <p className="hint">
      To read signal in dBm on an iPhone, install Apple’s free AirPort Utility,
      turn on Wi-Fi Scanner in Settings › AirPort Utility, then open it and tap
      Wi-Fi Scan, then Scan: it lists each network’s BSSID and RSSI in dBm.
      Apple no longer documents these steps, so they may change. On Android, a
      Wi-Fi analyser app shows the same.
    </p>
  )
}

/**
 * The survey spots on every floor; picking one shows its floor and selects
 * it (D71).
 */
function SurveyList() {
  const store = useEditorStore()
  const floors = useEditor((s) => s.plan.floors)
  const ignored = useEditor((s) => s.plan.ignoredBssids?.length ?? 0)
  const { chooseReadingsFile } = useSurveyImport()
  const { openScan } = useScan()
  const stack = stackedFloors(floors).reverse()
  const withSpots = stack.filter((f) => (f.surveySpots ?? []).length > 0)
  return (
    <>
      <h3>Survey spots</h3>
      {withSpots.length === 0 && (
        <p className="hint">
          No spots yet on any floor. Click the plan where you measured signal.
        </p>
      )}
      {withSpots.map((floor) => (
        <div key={floor.id} className="survey-floor">
          {floors.length > 1 && <h4>{floor.name}</h4>}
          <ul className="object-list">
            {floor.surveySpots!.map((spot) => (
              <li key={spot.id}>
                <button
                  type="button"
                  onClick={() => {
                    const state = store.getState()
                    state.setFloor(floor.id)
                    state.select([{ kind: 'surveySpot', id: spot.id }])
                  }}
                >
                  {surveySpotName(spot.id)}: {readingCount(spot.readings)}
                  {spot.note && ` (${spot.note})`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button
        type="button"
        className="add-reading"
        onClick={chooseReadingsFile}
      >
        Import readings…
      </button>
      <p className="hint">
        From a CSV or JSON file with a BSSID and dBm (or RSSI) column, and a
        spot or x and y in metres for each row.{' '}
        <a href={FLOORPLAN_IMPORT_URL}>The file format</a>
      </p>
      <button type="button" onClick={openScan}>
        Scan your network…
      </button>
      <p className="hint">
        Import what your computer or phone hears, to match your radios’ BSSIDs
        and add the neighbours’ networks.
      </p>
      {ignored > 0 && (
        <p className="hint">
          {ignored === 1 ? '1 BSSID is' : `${ignored} BSSIDs are`} marked not
          mine, so imports skip {ignored === 1 ? 'it' : 'them'}.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() =>
              store
                .getState()
                .edit(
                  'Forget BSSIDs marked not mine',
                  (plan) => void forgetIgnoredBssids(plan),
                  { keepOptimizer: true },
                )
            }
          >
            Forget {ignored === 1 ? 'it' : 'them'}
          </button>
        </p>
      )}
      {withSpots.length > 0 && <SurveyReport />}
      {withSpots.length > 0 && <CalibrateSection />}
    </>
  )
}

/**
 * Calibrate (D76): fits every band with readings, then shows each band's
 * fitted values next to the defaults with the held-out error before and
 * after, or what it still needs, with Apply or Dismiss. The map previews
 * the fit while it waits. Reset to defaults puts every band back.
 */
function CalibrateSection() {
  const store = useEditorStore()
  const calibrator = useCalibrator()
  const plan = useEditor((s) => s.plan)
  const state = useEditor((s) => s.modelCalibration)
  const note = calibratedNote(plan)
  const primary = useRef<HTMLButtonElement>(null)
  const focusInside = useRef(false)
  useEffect(() => {
    const active = document.activeElement
    if (focusInside.current && (!active || active === document.body)) {
      primary.current?.focus()
    }
  }, [state])
  const fitting = state?.status === 'fitting'
  const noReadings = !plan.floors.some((f) =>
    (f.surveySpots ?? []).some((spot) => spot.readings.length > 0),
  )
  return (
    <div
      className="calibrate"
      onFocus={() => (focusInside.current = true)}
      onBlur={() => (focusInside.current = false)}
    >
      <h3>Calibrate the model</h3>
      {state?.status !== 'result' ? (
        <>
          <p className="hint">
            {note ??
              (noReadings
                ? 'No readings to fit yet: add readings from your access points first.'
                : 'Fits the walls’ and floors’ losses and how fast signal fades to your readings, band by band, within published limits.')}
          </p>
          <div className="actions">
            <button
              ref={primary}
              type="button"
              disabled={fitting || noReadings}
              onClick={() => calibrator.start()}
            >
              {fitting
                ? 'Calibrating…'
                : note
                  ? 'Calibrate again'
                  : 'Calibrate'}
            </button>
            {note && (
              <button
                type="button"
                onClick={() => store.getState().resetModelCalibration()}
              >
                Reset to defaults
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {state.results.length === 0 && (
            <p className="hint">
              No readings to fit yet: add readings from your access points
              first.
            </p>
          )}
          {state.results.map(({ band, readiness, fit }) => (
            <section
              key={band}
              className="calibrate-band"
              aria-label={`${BAND_LABELS[band]} calibration`}
            >
              <h4>{BAND_LABELS[band]}</h4>
              <ApproximateNote band={band} />
              {!fit ? (
                <>
                  <p className="hint">Not enough spots to fit yet.</p>
                  {readinessLines(plan, readiness).map((line) => (
                    <p key={line} className="hint">
                      {line}
                    </p>
                  ))}
                  {readiness.floors.some(
                    (f) => f.roomsWithSpots < f.roomsNeeded,
                  ) && (
                    <p className="hint">
                      Rooms without a spot are ringed on the map while{' '}
                      {BAND_LABELS[band]} is on show.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="hint">{errorChange(fit)}</p>
                  {!improves(fit) && (
                    <p className="hint">
                      Not applied: it doesn’t predict the readings better than
                      the defaults.
                    </p>
                  )}
                  <table className="error-table calibrate-table">
                    <thead>
                      <tr>
                        <th scope="col">Value</th>
                        <th scope="col">Default</th>
                        <th scope="col">Fitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fitRows(fit).map((row) => (
                        <tr key={row.label}>
                          <th scope="row">
                            {row.label}
                            {row.note && (
                              <span className="field-note">{row.note}</span>
                            )}
                          </th>
                          <td>{row.defaultText}</td>
                          <td>{row.valueText}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          ))}
          {appliedFits(state.results).length > 0 && (
            <p className="hint">
              The map shows the calibration until you apply or dismiss it.
            </p>
          )}
          <div className="actions">
            <button
              ref={primary}
              type="button"
              className="primary"
              disabled={appliedFits(state.results).length === 0}
              onClick={() => store.getState().applyModelCalibration()}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => store.getState().dismissModelCalibration()}
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * How many of a band's readings Calibrate fits are approximate (D82), with
 * a word of caution when they're more than half.
 */
function ApproximateNote({ band }: { band: Band }) {
  const errors = useSurveyErrors()
  const row = summariseErrors(errors.readings).find((r) => r.band === band)
  if (!row || row.approximate === 0) return null
  return (
    <p className="hint">
      {row.approximate} of {row.count} readings are approximate (≈), converted
      from a signal percentage.
      {row.approximate * 2 > row.count &&
        ' That’s more than half, so this fit is only rough: a scan script’s readings in dBm, or readings typed in from a phone, would fit better.'}
    </p>
  )
}

/** How many of the spots furthest off the report lists (D73). */
const WORST_SPOT_COUNT = 5

/**
 * Predicted versus measured (D73): mean and RMS error for each band with
 * readings, and the spots furthest off, each with a button that shows its
 * floor and band and selects it.
 */
function SurveyReport() {
  const store = useEditorStore()
  const floors = useEditor((s) => s.plan.floors)
  const errors = useSurveyErrors()
  const summary = summariseErrors(errors.readings)
  const worst = worstSpots(errors.readings, WORST_SPOT_COUNT)
  const total = floors.reduce(
    (n, f) =>
      n + (f.surveySpots ?? []).reduce((m, s) => m + s.readings.length, 0),
    0,
  )
  const skipped = total - errors.readings.length
  // The first spot in the order the list shows: top floor first.
  const firstSpot =
    total === 0
      ? stackedFloors(floors)
          .reverse()
          .flatMap((f) =>
            (f.surveySpots ?? []).map((spot) => ({ spot, floorId: f.id })),
          )
          .at(0)
      : undefined
  const approximate = summary.reduce((n, row) => n + row.approximate, 0)
  return (
    <>
      <h3>Predicted versus measured</h3>
      {summary.length === 0 ? (
        firstSpot && (
          <EmptyState
            className="report-empty"
            action={`Add readings at ${surveySpotName(firstSpot.spot.id)}`}
            onAction={() => {
              const state = store.getState()
              state.setFloor(firstSpot.floorId)
              state.select([{ kind: 'surveySpot', id: firstSpot.spot.id }])
            }}
          >
            No readings yet. Add some to see how far the model is from what you
            measured.
          </EmptyState>
        )
      ) : (
        <>
          <table className="error-table">
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">Readings</th>
                <th scope="col">Mean error</th>
                <th scope="col">RMS error</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.band}>
                  <th scope="row">{BAND_LABELS[row.band]}</th>
                  <td>
                    {row.count}
                    {row.approximate > 0 && ` (${row.approximate} ≈)`}
                  </td>
                  <td>{formatErrorDb(row.meanDb)}</td>
                  <td>{row.rmsDb.toFixed(1)} dB</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Error is predicted minus measured. A mean above 0 means the model
            expects more signal than you measured; the RMS error is how far off
            a reading typically is, either way.
          </p>
          {approximate > 0 && (
            <p className="hint">
              {approximate === 1
                ? '1 reading is approximate (≈): it was'
                : `${approximate} readings are approximate (≈): they were`}{' '}
              converted from a signal percentage, so{' '}
              {approximate === 1 ? 'its' : 'their'} errors are only rough.
            </p>
          )}
        </>
      )}
      {skipped > 0 && (
        <p className="hint">
          {skipped === 1 ? '1 reading isn’t' : `${skipped} readings aren’t`}{' '}
          compared: {skipped === 1 ? 'its' : 'their'} band is turned off on the
          access point.
        </p>
      )}
      {worst.length > 0 && (
        <>
          <h4 className="survey-report">Furthest off</h4>
          <ul className="object-list">
            {worst.map((entry) => (
              <li key={entry.spotId}>
                <button
                  type="button"
                  onClick={() => {
                    const state = store.getState()
                    state.setFloor(entry.floorId)
                    state.setBand(entry.band)
                    state.select([{ kind: 'surveySpot', id: entry.spotId }])
                  }}
                >
                  {surveySpotName(entry.spotId)}
                  {floors.length > 1 &&
                    `, ${floors.find((f) => f.id === entry.floorId)?.name ?? ''}`}
                  , {BAND_LABELS[entry.band]}: {formatErrorDb(entry.meanDb)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** The survey pins' colours (D73), while the floor on show has any. */
function PinLegend() {
  return (
    <>
      <h2>Survey pins</h2>
      <ul className="legend">
        {errorLegendRows().map((row) => (
          <li key={row.label}>
            <span className="swatch" style={{ background: rgbCss(row.rgb) }} />
            <span className="legend-label">{row.label}</span>
            <span className="legend-range" />
          </li>
        ))}
      </ul>
      <p className="hint legend-note">
        Each pin is the mean of predicted minus measured over its readings on
        the band on show: orange where the model expects more signal than you
        measured, purple where less.
      </p>
    </>
  )
}

const readingCount = (readings: readonly unknown[]) =>
  readings.length === 0
    ? 'no readings'
    : `${readings.length} reading${readings.length === 1 ? '' : 's'}`

/** A selected survey spot: its readings, one per access point and band. */
function SurveySpotSection({ spot }: { spot: SurveySpot }) {
  const store = useEditorStore()
  const units = useEditor((s) => s.units)
  const plan = useEditor((s) => s.plan)
  const { chooseReadingsFile } = useSurveyImport()
  const { openScan } = useScan()
  const errors = useSurveyErrors()
  const name = surveySpotName(spot.id)
  const heard = spot.neighbourReadings?.length ?? 0
  // Readings don't change coverage, so a suggestion stays (D71).
  const edit = (label: string, change: (plan: Draft<Plan>) => void) =>
    store.getState().edit(label, change, { keepOptimizer: true })
  const used = new Set(spot.readings.map((r) => `${r.apId} ${r.band}`))
  const free = plan.accessPoints.some((ap) =>
    ap.radios.some((r) => !used.has(`${ap.id} ${r.band}`)),
  )
  return (
    <section>
      <h2>{name}</h2>
      <p className="kind">Survey spot</p>
      <dl>
        <dt>Position</dt>
        <dd>
          {formatLength(spot.x, units)}, {formatLength(spot.y, units)}
        </dd>
      </dl>
      <h3>Readings</h3>
      {spot.readings.length === 0 && (
        <p className="hint">
          No readings yet. Add one for each access point and band you measured
          here.
        </p>
      )}
      {plan.accessPoints.length === 0 && (
        <p className="hint">
          A reading is from an access point: place one first.
        </p>
      )}
      {spot.readings.map((_, i) => (
        <ReadingRow
          key={i}
          spot={spot}
          index={i}
          plan={plan}
          errors={errors}
          edit={edit}
        />
      ))}
      <button
        type="button"
        className="add-reading"
        disabled={!free}
        title={
          plan.accessPoints.length === 0
            ? 'Place an access point first'
            : free
              ? undefined
              : 'This spot has a reading for every access point and band'
        }
        onClick={() =>
          edit(`Add a reading at ${name}`, (draft) => {
            addSurveyReading(draft, spot.id)
          })
        }
      >
        Add a reading
      </button>
      <button type="button" onClick={chooseReadingsFile}>
        Import readings…
      </button>
      <p className="hint">
        Rows in the file with no spot or position go to {name}.
      </p>
      <button type="button" onClick={openScan}>
        Scan at this spot…
      </button>
      <p className="hint">
        Scan your network from here: your access points’ signals become
        readings, averaged with earlier scans here.
        {heard > 0 &&
          ` Scans here also heard ${heard === 1 ? '1 neighbour’s BSSID' : `${heard} neighbours’ BSSIDs`}.`}
      </p>
      <TextField
        label="Note"
        value={spot.note ?? ''}
        maxLength={500}
        placeholder="Such as “kitchen, phone on the counter”"
        onCommit={(value) =>
          edit(`Change ${name} note`, (draft) => {
            setSurveyNote(draft, spot.id, value)
          })
        }
      />
      <FadeHeatmapField />
      <ReadingHint />
      <p className="hint">
        Drag the pin to move it, or use the arrow keys (Shift for bigger steps).
      </p>
      <div className="actions">
        <DeleteButton />
      </div>
    </section>
  )
}

function ReadingRow({
  spot,
  index,
  plan,
  errors,
  edit,
}: {
  spot: SurveySpot
  index: number
  plan: Plan
  errors: SurveyErrors
  edit: (label: string, change: (plan: Draft<Plan>) => void) => void
}) {
  const apId = useId()
  const bandId = useId()
  const noteId = useId()
  const reading = spot.readings[index]!
  const ap = plan.accessPoints.find((a) => a.id === reading.apId)
  const name = surveySpotName(spot.id)
  const takenByOther = (id: string, band: Band) =>
    spot.readings.some(
      (r, i) => i !== index && r.apId === id && r.band === band,
    )
  const floorName = (floorId: string) =>
    plan.floors.length > 1
      ? ` (${plan.floors.find((f) => f.id === floorId)?.name ?? ''})`
      : ''
  const bandOff = !ap?.radios.some((r) => r.band === reading.band)
  const compared = errors.readings.find(
    (e) => e.spotId === spot.id && e.index === index,
  )
  const label = `${ap?.name ?? ''}, ${BAND_LABELS[reading.band]}`
  const hidden = <span className="visually-hidden">{label} </span>
  return (
    <fieldset className="neighbour">
      <legend>{label}</legend>
      <div className="neighbour-fields">
        <div className="field reading-ap">
          <label htmlFor={apId}>{hidden}Access point</label>
          <select
            id={apId}
            value={reading.apId}
            onChange={(event) => {
              const next = event.target.value
              edit(`Change a reading at ${name}`, (draft) => {
                setReadingSource(draft, spot.id, index, { apId: next })
              })
            }}
          >
            {plan.accessPoints.map((a) => (
              <option
                key={a.id}
                value={a.id}
                disabled={
                  a.id !== reading.apId &&
                  a.radios.every((r) => takenByOther(a.id, r.band))
                }
              >
                {a.name}
                {floorName(a.floorId)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={bandId}>{hidden}Band</label>
          <select
            id={bandId}
            value={reading.band}
            aria-invalid={bandOff}
            aria-describedby={bandOff ? noteId : undefined}
            onChange={(event) => {
              const band = event.target.value as Band
              edit(`Change a reading at ${name}`, (draft) => {
                setReadingSource(draft, spot.id, index, {
                  apId: reading.apId,
                  band,
                })
              })
            }}
          >
            {(ap?.radios ?? []).map(({ band }) => (
              <option
                key={band}
                value={band}
                disabled={takenByOther(reading.apId, band)}
              >
                {BAND_LABELS[band]}
              </option>
            ))}
            {bandOff && (
              <option value={reading.band}>
                {BAND_LABELS[reading.band]} (off)
              </option>
            )}
          </select>
        </div>
        <SettingField
          label={<>{hidden}Signal (dBm)</>}
          value={reading.dbm}
          range={SURVEY_READING_RANGE_DBM}
          onCommit={(value) => {
            if (value === undefined) return
            edit(`Change a reading at ${name}`, (draft) => {
              setReadingDbm(draft, spot.id, index, value)
            })
          }}
        />
      </div>
      {(reading.approximate || reading.scans) && (
        <p className="field-note">
          {[
            reading.approximate &&
              '≈ Approximate: converted from a signal percentage.',
            reading.scans && `The mean of ${reading.scans} scans.`,
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      {compared && (
        <p className="field-note reading-prediction">
          Predicted {formatDbm(compared.predictedDbm)}, error{' '}
          {formatErrorDb(compared.errorDb)}
        </p>
      )}
      {bandOff && (
        <p id={noteId} className="field-note field-warning">
          {ap?.name} has {BAND_LABELS[reading.band]} turned off, so this reading
          isn’t compared with the model. Turn it back on, or pick another band.
        </p>
      )}
      <button
        type="button"
        className="remove-neighbour"
        onClick={() =>
          edit(`Remove a reading at ${name}`, (draft) => {
            deleteSurveyReading(draft, spot.id, index)
          })
        }
      >
        Remove<span className="visually-hidden"> {label}</span>
      </button>
    </fieldset>
  )
}

/**
 * A radio's BSSIDs, one per network name it broadcasts, typed or pasted in
 * any common form (D71). A BSSID belongs to one radio, so one already on
 * another is refused.
 */
function BssidField({
  ap,
  radio,
  onCommit,
}: {
  ap: AccessPoint
  radio: Radio
  onCommit: (bssids: string[]) => void
}) {
  const plan = useEditor((s) => s.plan)
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()
  const id = useId()
  const current = (radio.bssids ?? []).join(', ')
  const reset = () => {
    setDraft(undefined)
    setError(undefined)
  }
  const commit = () => {
    if (draft === undefined || draft.trim() === current) return reset()
    const { bssids, invalid } = parseBssids(draft)
    if (invalid.length > 0) {
      setError(
        `${invalid.join(', ')} ${invalid.length === 1 ? 'isn’t a BSSID' : 'aren’t BSSIDs'}: use six pairs of 0–9 and a–f, like a4:2b:b0:12:34:56.`,
      )
      return
    }
    for (const bssid of bssids) {
      const owner = bssidOwner(plan, bssid, { apId: ap.id, band: radio.band })
      if (owner) {
        const other = plan.accessPoints.find((a) => a.id === owner.apId)
        setError(
          `${bssid} is already on ${other?.name ?? 'another access point'}, ${BAND_LABELS[owner.band]}. Remove it there first.`,
        )
        return
      }
    }
    reset()
    onCommit(bssids)
  }
  return (
    <div className="field bssid-field">
      <label htmlFor={id}>{BAND_LABELS[radio.band]} BSSIDs</label>
      <input
        id={id}
        value={draft ?? current}
        placeholder="Such as a4:2b:b0:12:34:56"
        aria-invalid={error !== undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(undefined)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') reset()
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
