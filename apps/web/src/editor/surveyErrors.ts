import {
  predictReadings,
  spotErrors,
  type ReadingError,
  type SpotError,
} from '@signalplan/engine'
import type { AccessPoint, Band, Plan, SurveySpot } from '@signalplan/floorplan'
import { useMemo } from 'react'
import type { Rgb } from '../mapView.ts'
import { useEditor } from './context.ts'

/**
 * Survey pins coloured by predicted − measured (D73). The steps are for
 * reading the map at a glance, not model numbers: within ±3 dB is neutral,
 * then 3–6, 6–10 and 10 dB or more either way.
 */
export const ERROR_STEPS_DB = [3, 6, 10] as const

/**
 * ColorBrewer's 7-class PuOr (colorbrewer2.org), which it marks colour-blind
 * safe: orange where the model is too hopeful (predicted above measured),
 * purple where it's too gloomy, from +10 dB or more down to −10 dB or less.
 */
export const ERROR_RGB: readonly Rgb[] = [
  [179, 88, 6],
  [241, 163, 64],
  [254, 224, 182],
  [247, 247, 247],
  [216, 218, 235],
  [153, 142, 195],
  [84, 39, 136],
]

/** The error rounded as a pin shows it, to whole dB, never −0. */
export const roundedErrorDb = (db: number) => Math.round(db) || 0

/**
 * Which of `ERROR_RGB` an error falls in, from its value rounded to whole dB,
 * so a pin's colour always agrees with its label.
 */
export function errorStep(db: number): number {
  const rounded = roundedErrorDb(db)
  const size = Math.abs(rounded)
  const away = ERROR_STEPS_DB.filter((step) => size >= step).length
  return rounded > 0 ? 3 - away : 3 + away
}

/** "+4.2 dB", "−6 dB" or "0 dB", with a true minus sign. */
export function formatErrorDb(db: number, digits = 1): string {
  const value = Number(db.toFixed(digits)) || 0
  const text = Math.abs(value).toFixed(digits)
  if (value > 0) return `+${text} dB`
  if (value < 0) return `−${text} dB`
  return `${text} dB`
}

/** A dBm value with a true minus sign, to 0.1 dB. */
export const formatDbm = (dbm: number) =>
  `${(Number(dbm.toFixed(1)) || 0).toFixed(1)}`.replace('-', '−') + ' dBm'

/** The legend's rows, from +10 dB or more down to −10 dB or less. */
export function errorLegendRows(): { rgb: Rgb; label: string }[] {
  const [a, b, c] = ERROR_STEPS_DB
  return [
    `+${c} dB or more`,
    `+${b} to +${c - 1} dB`,
    `+${a} to +${b - 1} dB`,
    `Within ±${a - 1} dB`,
    `−${a} to −${b - 1} dB`,
    `−${b} to −${c - 1} dB`,
    `−${c} dB or less`,
  ].map((label, i) => ({ rgb: ERROR_RGB[i]!, label }))
}

/** What a pin shows on the band on show: its mean error, or nothing. */
export function pinError(
  errors: readonly SpotError[],
  spotId: string,
  band: Band,
): { label: string; rgb: Rgb | undefined } {
  const entry = errors.find((e) => e.spotId === spotId && e.band === band)
  if (!entry) return { label: '–', rgb: undefined }
  return {
    label: formatErrorDb(roundedErrorDb(entry.meanDb), 0),
    rgb: ERROR_RGB[errorStep(entry.meanDb)],
  }
}

export interface SurveyErrors {
  readings: ReadingError[]
  spots: SpotError[]
}

export function surveyErrors(plan: Plan): SurveyErrors {
  const readings = predictReadings(plan)
  return { readings, spots: spotErrors(readings) }
}

/** Every reading's prediction and error, worked out again when the plan changes. */
export function useSurveyErrors(): SurveyErrors {
  const plan = useEditor((s) => s.plan)
  return useMemo(() => surveyErrors(plan), [plan])
}

/**
 * A hovered pin's card (D73): each reading on the band on show, measured,
 * predicted and the difference, or why it isn't compared.
 */
export function spotCardLines(
  spot: SurveySpot,
  band: Band,
  readings: readonly ReadingError[],
  accessPoints: readonly AccessPoint[],
): string[] {
  const lines = spot.readings.flatMap((reading, index) => {
    if (reading.band !== band) return []
    const name =
      accessPoints.find((a) => a.id === reading.apId)?.name ?? 'Removed'
    const measured = formatDbm(reading.dbm)
    const error = readings.find(
      (e) => e.spotId === spot.id && e.index === index,
    )
    if (!error) return [`${name}: measured ${measured}, band turned off`]
    return [
      `${name}: measured ${measured}, predicted ${formatDbm(error.predictedDbm)} (${formatErrorDb(error.errorDb)})`,
    ]
  })
  return lines.length > 0 ? lines : ['No readings on this band']
}
