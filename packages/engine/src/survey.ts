import { BANDS, type Band, type Plan } from '@signalplan/floorplan'
import type { Calibration } from './calibration.ts'
import { RECEIVER_HEIGHT_M, signalDbm } from './coverage.ts'
import { preparedWallLoss } from './crossings.ts'
import {
  crossingLossDb,
  floorCrossing,
  prepareStack,
  type Storey,
} from './floors.ts'

/** One survey reading next to the model's prediction for it (D73). */
export interface ReadingError {
  spotId: string
  floorId: string
  /** Where the reading is in its spot's list. */
  index: number
  apId: string
  band: Band
  measuredDbm: number
  predictedDbm: number
  /** Predicted − measured, in dB: above 0 the model is too hopeful. */
  errorDb: number
}

/**
 * The model's prediction at each survey spot for each reading's access point
 * and band, worked out as the heatmap does (`evaluateCoverage`): a receiver
 * 1 m above the spot's floor, 3D distance, this floor's walls, and from
 * another floor the slabs and each storey's walls along the path. The value
 * is at the spot itself, not at the centre of the grid cell it falls in.
 * A reading from an access point with that band turned off is left out.
 * Calibrated values replace the defaults where given (D75): the plan's own
 * unless others are passed, and `{}` gives the defaults. A calibration's
 * device offset is added here, to compare with what the phone showed, but
 * never to the heatmap (D76).
 */
export function predictReadings(
  plan: Plan,
  calibration: Calibration = plan.calibration ?? {},
): ReadingError[] {
  const stacks = new Map<Band, Storey[]>()
  const stackFor = (band: Band) => {
    let stack = stacks.get(band)
    if (!stack) {
      stack = prepareStack(plan, band, calibration[band] ?? {})
      stacks.set(band, stack)
    }
    return stack
  }
  const aps = new Map(plan.accessPoints.map((ap) => [ap.id, ap]))
  const errors: ReadingError[] = []
  for (const floor of plan.floors) {
    for (const spot of floor.surveySpots ?? []) {
      spot.readings.forEach((reading, index) => {
        const ap = aps.get(reading.apId)
        const radio = ap?.radios.find((r) => r.band === reading.band)
        if (!ap || !radio) return
        const stack = stackFor(reading.band)
        const here = stack.findIndex((s) => s.floor.id === floor.id)
        const from = stack.findIndex((s) => s.floor.id === ap.floorId)
        if (here < 0 || from < 0) return
        let loss: number
        let dz: number
        if (from === here) {
          loss = preparedWallLoss(
            stack[here]!.walls,
            ap.x,
            ap.y,
            spot.x,
            spot.y,
          )
          dz = ap.heightM - RECEIVER_HEIGHT_M
        } else {
          const apZ = stack[from]!.floor.elevationM + ap.heightM
          const receiverZ = floor.elevationM + RECEIVER_HEIGHT_M
          const crossing = floorCrossing(stack, from, apZ, here, receiverZ)
          loss = crossingLossDb(crossing, ap.x, ap.y, spot.x, spot.y)
          dz = apZ - receiverZ
        }
        const bandCalibration = calibration[reading.band]
        const predictedDbm =
          signalDbm(
            ap,
            radio,
            spot.x,
            spot.y,
            loss,
            dz,
            bandCalibration?.pathLossExponent,
          ) + (bandCalibration?.deviceOffsetDb ?? 0)
        errors.push({
          spotId: spot.id,
          floorId: floor.id,
          index,
          apId: ap.id,
          band: reading.band,
          measuredDbm: reading.dbm,
          predictedDbm,
          errorDb: predictedDbm - reading.dbm,
        })
      })
    }
  }
  return errors
}

/** How far off the model is on one band, over every reading on it (D73). */
export interface BandErrorSummary {
  band: Band
  count: number
  /** Mean of predicted − measured: the model's bias. */
  meanDb: number
  /** Root mean square of predicted − measured. */
  rmsDb: number
}

/** A summary for each band with readings, in the order of `BANDS`. */
export function summariseErrors(
  errors: readonly ReadingError[],
): BandErrorSummary[] {
  return BANDS.flatMap((band) => {
    const values = errors.filter((e) => e.band === band).map((e) => e.errorDb)
    if (values.length === 0) return []
    const sum = values.reduce((total, v) => total + v, 0)
    const squares = values.reduce((total, v) => total + v * v, 0)
    return [
      {
        band,
        count: values.length,
        meanDb: sum / values.length,
        rmsDb: Math.sqrt(squares / values.length),
      },
    ]
  })
}

/** One spot's readings on one band, and their mean error (D73). */
export interface SpotError {
  spotId: string
  floorId: string
  band: Band
  count: number
  meanDb: number
}

/**
 * The mean error of each spot on each band it has readings on, spots in the
 * order of `errors`, and each spot's bands in the order of `BANDS`.
 */
export function spotErrors(errors: readonly ReadingError[]): SpotError[] {
  const spots = new Map<string, Map<Band, SpotError>>()
  for (const e of errors) {
    let bands = spots.get(e.spotId)
    if (!bands) {
      bands = new Map()
      spots.set(e.spotId, bands)
    }
    const entry = bands.get(e.band)
    if (entry) {
      entry.meanDb += e.errorDb
      entry.count++
    } else {
      bands.set(e.band, {
        spotId: e.spotId,
        floorId: e.floorId,
        band: e.band,
        count: 1,
        meanDb: e.errorDb,
      })
    }
  }
  return [...spots.values()].flatMap((bands) =>
    BANDS.flatMap((band) => {
      const entry = bands.get(band)
      return entry ? [{ ...entry, meanDb: entry.meanDb / entry.count }] : []
    }),
  )
}

/**
 * The spots furthest off, largest mean error either way first. Each spot
 * appears once, with the band it's furthest off on; ties keep the order of
 * `errors`.
 */
export function worstSpots(
  errors: readonly ReadingError[],
  limit: number,
): SpotError[] {
  const worst = new Map<string, SpotError>()
  for (const entry of spotErrors(errors)) {
    const current = worst.get(entry.spotId)
    if (!current || Math.abs(entry.meanDb) > Math.abs(current.meanDb)) {
      worst.set(entry.spotId, entry)
    }
  }
  return [...worst.values()]
    .sort((a, b) => Math.abs(b.meanDb) - Math.abs(a.meanDb))
    .slice(0, limit)
}
