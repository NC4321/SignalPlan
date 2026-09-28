import type { Band } from '@signalplan/floorplan'
import { freeSpacePathLoss } from './pathLoss.ts'

export interface BandProfile {
  band: Band
  /** Edges of the band's channels in North America, in GHz. */
  lowGHz: number
  highGHz: number
  /** Frequency used for the reference loss, in GHz: the band's midpoint. */
  referenceGHz: number
  /** Free-space loss at the 1 m reference distance, in dB. */
  referenceLossDb: number
  /**
   * Path loss exponent n. Walls are counted explicitly, so the distance term is
   * free space (n = 2), as in the COST 231 multi-wall model. Calibration
   * (Phase 7) may adjust it.
   */
  pathLossExponent: number
  /**
   * Default EIRP in dBm when a radio doesn't set one. Assumed typical for a
   * consumer router, within the US and EU limits in `regions.json` (D62).
   */
  defaultTxPowerDbm: number
}

function profile(
  band: Band,
  lowGHz: number,
  highGHz: number,
  defaultTxPowerDbm: number,
): BandProfile {
  const referenceGHz = (lowGHz + highGHz) / 2
  return {
    band,
    lowGHz,
    highGHz,
    referenceGHz,
    referenceLossDb: freeSpacePathLoss(1, referenceGHz * 1e9),
    pathLossExponent: 2,
    defaultTxPowerDbm,
  }
}

/**
 * North American band profiles.
 * - 2.4 GHz: channels 1–11 span 2.401–2.473 GHz.
 * - 5 GHz: U-NII-1 to U-NII-4 span 5.150–5.895 GHz.
 * - 6 GHz: U-NII-5 to U-NII-8 span 5.925–7.125 GHz. The default is the
 *   low-power indoor limit of 5 dBm/MHz over a 20 MHz beacon channel.
 *
 * The band edges set the reference frequency for path loss and are the same
 * for every region. Channels and power limits differ by region and live in
 * `regions.json` (D62).
 */
export const BAND_PROFILES: Readonly<Record<Band, BandProfile>> = {
  '2.4GHz': profile('2.4GHz', 2.401, 2.473, 20),
  '5GHz': profile('5GHz', 5.15, 5.895, 23),
  '6GHz': profile('6GHz', 5.925, 7.125, 18),
}

/** Evenly spaced frequencies across a band, in GHz, for averaging. */
export function bandSamples(profile: BandProfile, count = 25): number[] {
  const step = (profile.highGHz - profile.lowGHz) / (count - 1)
  return Array.from({ length: count }, (_, i) => profile.lowGHz + i * step)
}
