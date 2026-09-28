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
   * consumer router, below the FCC / ISED limits noted in docs/MODEL.md.
   */
  defaultTxPowerDbm: number
  /**
   * The highest EIRP the FCC allows in any part of the band, in dBm. Above it
   * the editor shows a note; the value is still accepted (D25).
   */
  maxEirpDbm: number
  /** Where `maxEirpDbm` comes from, for the note. */
  maxEirpNote: string
}

function profile(
  band: Band,
  lowGHz: number,
  highGHz: number,
  defaultTxPowerDbm: number,
  maxEirpDbm: number,
  maxEirpNote: string,
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
    maxEirpDbm,
    maxEirpNote,
  }
}

/**
 * North American band profiles.
 * - 2.4 GHz: channels 1–11 span 2.401–2.473 GHz.
 * - 5 GHz: U-NII-1 to U-NII-4 span 5.150–5.895 GHz.
 * - 6 GHz: U-NII-5 to U-NII-8 span 5.925–7.125 GHz. The default is the
 *   low-power indoor limit of 5 dBm/MHz over a 20 MHz beacon channel.
 *
 * FCC limits (47 CFR Part 15), where 1 W conducted with a 6 dBi antenna is
 * 36 dBm EIRP; higher-gain antennas must reduce power by the excess:
 * - 2.4 GHz: 1 W conducted, antennas up to 6 dBi (§ 15.247(b)(3), (b)(4)).
 * - 5 GHz: 1 W in U-NII-1 and U-NII-3, 250 mW in U-NII-2A/2C, each with
 *   antennas up to 6 dBi (§ 15.407(a)(1)–(3)(i)); indoor access points in
 *   U-NII-4 at most 36 dBm EIRP (§ 15.407(a)(3)(ii)).
 * - 6 GHz low-power indoor: 5 dBm/MHz EIRP and at most 30 dBm
 *   (§ 15.407(a)(5)).
 */
export const BAND_PROFILES: Readonly<Record<Band, BandProfile>> = {
  '2.4GHz': profile(
    '2.4GHz',
    2.401,
    2.473,
    20,
    36,
    'The FCC limit at 2.4 GHz is 36 dBm EIRP (§ 15.247).',
  ),
  '5GHz': profile(
    '5GHz',
    5.15,
    5.895,
    23,
    36,
    'The FCC limit at 5 GHz is 36 dBm EIRP on U-NII-1, 3 and 4 channels, and 30 dBm on U-NII-2 (§ 15.407).',
  ),
  '6GHz': profile(
    '6GHz',
    5.925,
    7.125,
    18,
    30,
    'The FCC limit for indoor 6 GHz is 5 dBm/MHz, so 18 dBm on a 20 MHz channel and at most 30 dBm on the widest (§ 15.407).',
  ),
}

/** Evenly spaced frequencies across a band, in GHz, for averaging. */
export function bandSamples(profile: BandProfile, count = 25): number[] {
  const step = (profile.highGHz - profile.lowGHz) / (count - 1)
  return Array.from({ length: count }, (_, i) => profile.lowGHz + i * step)
}
