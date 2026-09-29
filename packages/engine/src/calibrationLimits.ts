import type { Band, FloorMaterial, WallMaterial } from '@signalplan/floorplan'
import { FLOOR_LOSS_DB, MATERIAL_LOSS_DB } from './materials.ts'

/**
 * Limits for the calibration fit (D75). Every one comes from a primary
 * source; docs/MODEL.md has the tables with each value's source.
 */

/** A measured loss in dB that a material's calibrated value may reach. */
export interface Measurement {
  lossDb: number
  /** Where it comes from, as in docs/MODEL.md. */
  source: string
}

const nist = (sample: string, lossDb: number): Measurement => ({
  lossDb,
  source: `NISTIR 6055, ${sample}`,
})
const muqaibel = (sample: string, lossDb: number): Measurement => ({
  lossDb,
  source: `Muqaibel, Table 4.3, ${sample}`,
})
const shakya = (sample: string, lossDb: number): Measurement => ({
  lossDb,
  source: `Shakya et al., Table II, ${sample}`,
})
const rhim = (state: string, lossDb: number): Measurement => ({
  lossDb,
  source: `Rhim, Table 3-3, ${state}, 203 mm`,
})
const p1238 = (what: string, lossDb: number): Measurement => ({
  lossDb,
  source: `ITU-R P.1238-13, ${what}`,
})

/**
 * Measured losses behind each wall material's default, by band, as in
 * docs/MODEL.md's validation tables (averaged over the band as power, like
 * the model). 2.4 GHz uses NIST at 2.0 GHz and Anderson and Rappaport at
 * 2.5 GHz, the closest there are. Concrete takes 203 mm samples only, like
 * the 200 mm wall, with Rhim's four moisture states worked out as slabs.
 * Low-E glass and metal have one measurement each (Shakya) and aren't fitted.
 */
export const WALL_MEASUREMENTS: Readonly<
  Record<Band, Readonly<Partial<Record<WallMaterial, readonly Measurement[]>>>>
> = {
  '2.4GHz': {
    drywall: [
      nist('D50L, 12.52 mm, 2.0 GHz', 0.6),
      {
        lossDb: 5.4,
        source: 'Anderson and Rappaport, Table III, drywall, 2.5 GHz',
      },
    ],
    brick: [
      nist('B1L, 90.4 mm, 2.0 GHz', 5.4),
      nist('B2L, 178 mm, 2.0 GHz', 7.6),
      muqaibel('brick wall, 87.1 mm', 3.6),
    ],
    concrete: [
      nist('203 mm, lowest mix, 2.0 GHz', 28.6),
      nist('203 mm, highest mix, 2.0 GHz', 34.9),
      rhim('oven dried', 2.5),
      rhim('air dried', 1.4),
      rhim('saturated', 14.0),
      rhim('wet', 24.1),
    ],
    glass: [
      nist('G25L, 5.68 mm, 2.0 GHz', 1.4),
      nist('G50L, 12.52 mm, 2.0 GHz', 3.3),
      nist('G75L, 18.60 mm, 2.0 GHz', 3.9),
      muqaibel('glass, 2.36 mm', 0.8),
      {
        lossDb: 6.4,
        source: 'Anderson and Rappaport, Table III, clear glass, 2.5 GHz',
      },
    ],
    wood: [
      nist('L15DL, 36.95 mm, 2.0 GHz', 3.3),
      nist('L30DL, 75.42 mm, 2.0 GHz', 4.8),
      muqaibel('wooden door, 44.5 mm', 1.0),
    ],
  },
  '5GHz': {
    drywall: [nist('D25H, 6.94 mm', 0.0), nist('D50H, 12.52 mm', -0.2)],
    brick: [nist('B1H, 90.4 mm', 15.4), muqaibel('brick wall, 87.1 mm', 6.9)],
    concrete: [
      nist('203 mm, lowest mix', 54.6),
      nist('203 mm, highest mix', 57.2),
      rhim('oven dried', 3.6),
      rhim('air dried', 6.6),
      rhim('saturated', 29.7),
      rhim('wet', 50.8),
    ],
    glass: [
      nist('G25H, 5.68 mm', 1.0),
      nist('G50H, 12.52 mm', 0.3),
      nist('G75H, 18.60 mm', 0.4),
      muqaibel('glass, 2.36 mm', 1.7),
    ],
    wood: [
      nist('L15DH, 36.95 mm', 3.4),
      nist('L30DH, 75.42 mm', 7.7),
      muqaibel('wooden door, 44.5 mm', 2.2),
    ],
  },
  '6GHz': {
    drywall: [
      nist('D25H, 6.94 mm', 0.1),
      nist('D50H, 12.52 mm', 0.0),
      shakya('drywall panel, 30 mm', 0.6),
      shakya('plasterboard wall, 137 mm', 2.1),
    ],
    brick: [nist('B1H, 90.4 mm', 15.6), muqaibel('brick wall, 87.1 mm', 7.9)],
    concrete: [
      nist('203 mm, lowest mix', 59.2),
      nist('203 mm, highest mix', 62.4),
      rhim('oven dried', 4.4),
      rhim('air dried', 8.7),
      rhim('saturated', 35.0),
      rhim('wet', 59.2),
    ],
    glass: [
      nist('G25H, 5.68 mm', 1.2),
      nist('G50H, 12.52 mm', 0.9),
      nist('G75H, 18.60 mm', 0.5),
      muqaibel('glass, 2.36 mm', 2.0),
      shakya('clear glass, 10 mm', 3.6),
    ],
    'low-e-glass': [shakya('low-E window, 20 mm', 29.7)],
    wood: [
      nist('L15DH, 36.95 mm', 3.8),
      nist('L30DH, 75.42 mm', 8.2),
      muqaibel('wooden door, 44.5 mm', 2.6),
      shakya('wooden door, 45 mm', 5.8),
    ],
    metal: [shakya('steel door, 47 mm', 43.2)],
  },
}

/**
 * Head-on floor losses from ITU-R P.1238-13: Table 5's residential floor
 * factors at 2.4 and 5.2 GHz, and at 5.2 GHz the 20 dB (σ 1.5 dB) of a
 * reinforced concrete floor at normal incidence, taken to 2σ above. Table 5
 * has nothing above 5.8 GHz, so 6 GHz floors aren't fitted. The factors
 * cover a whole floor, not only its slab (docs/MODEL.md).
 */
export const FLOOR_MEASUREMENTS: Readonly<
  Record<Band, Readonly<Partial<Record<FloorMaterial, readonly Measurement[]>>>>
> = {
  '2.4GHz': {
    'timber-joist': [p1238('Table 5, house, 2.4 GHz', 5)],
    'concrete-slab': [p1238('Table 5, apartment, 2.4 GHz', 10)],
  },
  '5GHz': {
    'timber-joist': [p1238('Table 5, house, 5.2 GHz', 7)],
    'concrete-slab': [
      p1238('Table 5, apartment, 5.2 GHz', 13),
      p1238('concrete floor at normal incidence, 20 dB + 2 × 1.5 dB', 23),
    ],
  },
  '6GHz': {},
}

/**
 * A wall material is fitted in a band only with at least this many
 * measurements there; a floor needs one, beside its default (D75).
 */
export const MIN_WALL_MEASUREMENTS = 2
export const MIN_FLOOR_MEASUREMENTS = 1

/**
 * The lowest and highest of a material's default and its measurements,
 * never below 0 dB, or undefined when it has too few measurements.
 */
function limits(
  defaultDb: number,
  measurements: readonly Measurement[] | undefined,
  minimum: number,
): [number, number] | undefined {
  if (!measurements || measurements.length < minimum) return undefined
  const values = [defaultDb, ...measurements.map((m) => m.lossDb)]
  return [Math.max(Math.min(...values), 0), Math.max(...values)]
}

/** A wall material's limits in a band, or undefined if it isn't fitted. */
export function wallLimitsDb(
  band: Band,
  material: WallMaterial,
): [number, number] | undefined {
  return limits(
    MATERIAL_LOSS_DB[band][material],
    WALL_MEASUREMENTS[band][material],
    MIN_WALL_MEASUREMENTS,
  )
}

/** A floor's head-on limits in a band, or undefined if it isn't fitted. */
export function floorLimitsDb(
  band: Band,
  material: FloorMaterial,
): [number, number] | undefined {
  return limits(
    FLOOR_LOSS_DB[band][material],
    FLOOR_MEASUREMENTS[band][material],
    MIN_FLOOR_MEASUREMENTS,
  )
}

/**
 * Limits of the path loss exponent n: ITU-R P.1238-13 Table 2's office
 * coefficients α for line of sight (1.47) and no line of sight (2.39), the
 * environment docs/MODEL.md already compares homes with. The walls are
 * counted on their own here, so n stays near 2 unless the readings show
 * otherwise.
 */
export const EXPONENT_LIMITS: readonly [number, number] = [1.47, 2.39]

/**
 * Limits of the device offset, in dB: Lui et al. (ICL-GNSS 2011) saw the
 * averaged RSSI of different Wi-Fi devices at the same point differ by as
 * much as 30 dB. A phone's offset from the model's ideal receiver is taken
 * as no more than that either way; this is inferred, since the paper
 * compares devices with each other, not with a reference (D75).
 */
export const DEVICE_OFFSET_LIMITS_DB: readonly [number, number] = [-30, 30]
