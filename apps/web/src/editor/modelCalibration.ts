import {
  predictReadings,
  type BandCalibrationResult,
  type BandFit,
  type CalibrationMessage,
  type CalibrationRequest,
  type FittedValue,
  type MaterialFit,
  type SurveyReadiness,
} from '@signalplan/engine'
import {
  BANDS,
  type Band,
  type BandCalibration,
  type Calibration,
  type FloorMaterial,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import { produce, type Draft } from 'immer'
import type { StoreApi } from 'zustand/vanilla'
import { listNames } from './channelPlan.ts'
import { BAND_LABELS, formatErrorDb } from './coverageText.ts'
import type { EditorState } from './store.ts'
import { WALL_STYLES } from './wallStyles.ts'

/**
 * Calibrate in the editor (D76): fitting every band with readings in a
 * worker, the fit waiting for Apply or Dismiss while the map previews it,
 * and the words the panel shows. Named for the model, to keep it apart from
 * the tracing image's scale calibration (D22).
 */

export type ModelCalibrationState =
  { status: 'fitting' } | { status: 'result'; results: BandCalibrationResult[] }

/** Bands with a reading the model can compare, in the order of `BANDS`. */
export function bandsWithReadings(plan: Plan): Band[] {
  const readings = predictReadings(plan, {})
  return BANDS.filter((band) => readings.some((r) => r.band === band))
}

/**
 * Whether Apply saves a band's fit: only if it predicts the held-out
 * readings better than the defaults, so calibrating never makes the model
 * worse at the spots it was checked on.
 */
export const improves = (fit: BandFit) => fit.after.rmsDb < fit.before.rmsDb

/** The fits Apply saves. */
export function appliedFits(
  results: readonly BandCalibrationResult[],
): { band: Band; fit: BandFit }[] {
  return results.flatMap(({ band, fit }) =>
    fit && improves(fit) ? [{ band, fit }] : [],
  )
}

/**
 * The plan's calibration after Apply: each band whose fit improves is
 * replaced, and the others keep what they had. Undefined when nothing
 * would change.
 */
export function pendingCalibration(
  plan: Plan,
  results: readonly BandCalibrationResult[],
): Calibration | undefined {
  const fits = appliedFits(results)
  if (fits.length === 0) return undefined
  const calibration: Calibration = { ...plan.calibration }
  for (const { band, fit } of fits) calibration[band] = fit.calibration
  return calibration
}

export function calibrationRecipe(calibration: Calibration | undefined) {
  return (plan: Draft<Plan>) => {
    if (calibration) plan.calibration = calibration
    else delete plan.calibration
  }
}

/** The plan as it would be after Apply, for the map's preview. */
export function withModelCalibration(
  plan: Plan,
  state: ModelCalibrationState | undefined,
): Plan {
  if (state?.status !== 'result') return plan
  const calibration = pendingCalibration(plan, state.results)
  return calibration ? produce(plan, calibrationRecipe(calibration)) : plan
}

const isEmpty = (calibration: BandCalibration | undefined) =>
  !calibration || Object.keys(calibration).length === 0

/** The bands the plan is calibrated on. */
export const calibratedBands = (plan: Plan): Band[] =>
  BANDS.filter((band) => !isEmpty(plan.calibration?.[band]))

/** "Calibrated to this home’s survey on 2.4 and 5 GHz.", or undefined. */
export function calibratedNote(plan: Plan): string | undefined {
  const bands = calibratedBands(plan)
  if (bands.length === 0) return undefined
  return `Calibrated to this home’s survey on ${listNames(bands.map((b) => BAND_LABELS[b]))}.`
}

/** What a band still needs before it can be fitted (D75). */
export function readinessLines(
  plan: Plan,
  readiness: SurveyReadiness,
): string[] {
  const lines: string[] = []
  if (readiness.spots < readiness.spotsNeeded) {
    lines.push(
      `Needs readings at ${readiness.spotsNeeded} spots or more; has ${readiness.spots}.`,
    )
  }
  const named = plan.floors.length > 1
  for (const floor of readiness.floors) {
    if (floor.roomsWithSpots >= floor.roomsNeeded) continue
    const name = plan.floors.find((f) => f.id === floor.floorId)?.name
    const where = named && name ? `${name}: spots` : 'Spots'
    lines.push(
      `${where} in ${floor.roomsWithSpots} of ${floor.rooms} rooms; needs ${floor.roomsNeeded}.`,
    )
  }
  return lines
}

const FLOOR_LABELS: Record<FloorMaterial, string> = {
  'timber-joist': 'Timber joist floor',
  'concrete-slab': 'Concrete slab floor',
}

/** One row of a band's table: a value, its default and the fitted one. */
export interface FitRow {
  label: string
  defaultText: string
  valueText: string
  /** Why it kept its default, that it stopped at a limit, or what it's for. */
  note: string | undefined
}

const db = (value: number) => `${value.toFixed(1)} dB`

function valueRow(
  label: string,
  value: FittedValue,
  format: (v: number) => string,
  note?: string,
): FitRow {
  const notes = [note, value.atLimit ? 'at its limit' : undefined].filter(
    (n) => n !== undefined,
  )
  return {
    label,
    defaultText: format(value.defaultValue),
    valueText: format(value.value),
    note: notes.length > 0 ? capitalise(notes.join('; ')) + '.' : undefined,
  }
}

const capitalise = (text: string) => text[0]!.toUpperCase() + text.slice(1)

function materialRow<M extends string>(
  label: string,
  fit: MaterialFit<M>,
): FitRow {
  const crossed = `${fit.readings} reading${fit.readings === 1 ? '' : 's'} from ${fit.spots} spot${fit.spots === 1 ? '' : 's'}`
  let note: string
  if (fit.kept === 'too-few-paths') note = `Kept: crossed by only ${crossed}.`
  else if (fit.kept === 'no-limits') {
    note = 'Kept: too few published measurements to bound it.'
  } else {
    note = `Crossed by ${crossed}${fit.atLimit ? '; at its limit' : ''}.`
  }
  return {
    label,
    defaultText: db(fit.defaultDb),
    valueText: db(fit.valueDb),
    note,
  }
}

/** A band's table, in the order the fit lists its values. */
export function fitRows(fit: BandFit): FitRow[] {
  return [
    valueRow('Path loss exponent', fit.exponent, (v) => v.toFixed(2)),
    valueRow(
      'Phone offset',
      fit.deviceOffsetDb,
      (v) => formatErrorDb(v),
      'only when comparing with readings, not on the heatmap',
    ),
    ...fit.walls.map((w) =>
      materialRow<WallMaterial>(WALL_STYLES[w.material].label, w),
    ),
    ...fit.floors.map((f) =>
      materialRow<FloorMaterial>(FLOOR_LABELS[f.material], f),
    ),
  ]
}

/** "RMS error 7.9 → 3.1 dB, mean +5.2 → +0.3 dB, held out by spot." */
export function errorChange(fit: BandFit): string {
  const { before, after } = fit
  return `RMS error ${before.rmsDb.toFixed(1)} → ${after.rmsDb.toFixed(1)} dB, mean ${formatErrorDb(before.meanDb)} → ${formatErrorDb(after.meanDb)}, each spot predicted by a fit to the others.`
}

export interface CalibrationWorker {
  postMessage(request: CalibrationRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<CalibrationMessage>) => void) | null
}

export interface ModelCalibrator {
  /** Fits every band with readings, for Apply or Dismiss. */
  start: () => void
  dispose: () => void
}

/**
 * Runs fits in a fresh worker each time, a band at a time, so the heatmap
 * keeps updating meanwhile. The store holds the state; whenever it stops
 * being "fitting" (an edit making the fit stale), the worker is terminated.
 */
export function createModelCalibrator(
  store: StoreApi<EditorState>,
  makeWorker: () => CalibrationWorker,
): ModelCalibrator {
  let worker: CalibrationWorker | undefined
  let unsubscribe: (() => void) | undefined
  let nextId = 0
  const stop = () => {
    worker?.terminate()
    worker = undefined
    unsubscribe?.()
    unsubscribe = undefined
  }

  return {
    start() {
      stop()
      const { plan, setModelCalibration } = store.getState()
      const bands = bandsWithReadings(plan)
      if (bands.length === 0) {
        setModelCalibration({ status: 'result', results: [] })
        return
      }
      const w = makeWorker()
      worker = w
      const ids = new Map(bands.map((band) => [nextId++, band]))
      const results = new Map<Band, BandCalibrationResult>()
      w.onmessage = ({ data }) => {
        if (worker !== w || !ids.has(data.id)) return
        if (data.kind === 'error') {
          stop()
          store.getState().setModelCalibration(undefined)
          store.getState().setNotice(`Couldn’t calibrate: ${data.message}`)
          return
        }
        results.set(data.result.band, data.result)
        if (results.size < bands.length) return
        stop()
        store.getState().setModelCalibration({
          status: 'result',
          results: bands.map((band) => results.get(band)!),
        })
      }
      setModelCalibration({ status: 'fitting' })
      unsubscribe = store.subscribe((state) => {
        if (state.modelCalibration?.status !== 'fitting') stop()
      })
      for (const [id, band] of ids) {
        w.postMessage({ id, kind: 'calibrate', plan, band })
      }
    },
    dispose: stop,
  }
}
