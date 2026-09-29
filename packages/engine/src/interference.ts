import type { Band, ChannelWidth, Plan, Radio } from '@signalplan/floorplan'
import type { Coverage } from './coverage.ts'
import { channelSpanMHz, channelWidths } from './regions.ts'

/**
 * Signal to interference and noise, SINR (D61, D66): the strongest access
 * point's signal over the same-channel access points' signal plus thermal
 * noise for the channel width. Like the Overlap and Roaming views it comes
 * from a coverage result, so it needs no extra engine run.
 */

/**
 * Thermal noise density kT₀ at the reference temperature T₀ = 290 K:
 * 1.380649 × 10⁻²³ J/K × 290 K = 4.004 × 10⁻²¹ W/Hz = −173.98 dBm/Hz
 * (Boltzmann constant from the SI Brochure, 9th ed.; T₀, "fixed, by
 * convention, around 290 K", from ITU-R V.573-5, term F03).
 */
export const THERMAL_NOISE_DBM_PER_HZ = -173.98

/**
 * The receiver noise figure IEEE 802.11 assumes when it sets its minimum
 * receiver sensitivities (10 dB, with a 5 dB implementation margin), so the
 * SINR each data rate needs below comes out on the same footing.
 */
export const RECEIVER_NOISE_FIGURE_DB = 10

/**
 * The width a radio is taken to use when it leaves its width to the planner
 * (D66): common router defaults, narrowed to what the region allows.
 */
export const AUTO_WIDTH_MHZ: Readonly<Record<Band, ChannelWidth>> = {
  '2.4GHz': 20,
  '5GHz': 80,
  '6GHz': 80,
}

/** Thermal noise plus the receiver's noise figure in a channel, in dBm. */
export function noiseFloorDbm(widthMHz: number): number {
  return (
    THERMAL_NOISE_DBM_PER_HZ +
    10 * Math.log10(widthMHz * 1e6) +
    RECEIVER_NOISE_FIGURE_DB
  )
}

/**
 * IEEE 802.11 minimum receiver sensitivity in a 20 MHz channel, in dBm, for
 * the rates the Interference view's bands are named after: VHT (802.11-2020
 * Table 21-25) and HE (802.11ax) MCS values. Wider channels add 3 dB per
 * doubling to both the sensitivity and the noise, so the SINR a rate needs
 * doesn't depend on the width.
 */
export const SENSITIVITY_20MHZ_DBM = {
  /** MCS 0, BPSK 1/2: the slowest rate. */
  mcs0: -82,
  /** MCS 4, 16-QAM 3/4. */
  mcs4: -70,
  /** MCS 7, 64-QAM 5/6: Wi-Fi 4's fastest. */
  mcs7: -64,
  /** MCS 9, 256-QAM 5/6: Wi-Fi 5's fastest. */
  mcs9: -57,
  /** MCS 11, 1024-QAM 5/6: Wi-Fi 6's fastest. */
  mcs11: -52,
} as const

export type Rate = keyof typeof SENSITIVITY_20MHZ_DBM

/**
 * The SINR a receiver built to the standard needs for a rate, in dB: its
 * sensitivity less the noise floor that sensitivity assumes. MCS 0 needs
 * about 9 dB and MCS 11 about 39 dB.
 */
export function requiredSinrDb(rate: Rate): number {
  return SENSITIVITY_20MHZ_DBM[rate] - noiseFloorDbm(20)
}

/** A radio's channel for interference: undefined channel means Auto. */
export interface Tuning {
  channel: number | undefined
  widthMHz: ChannelWidth
}

/**
 * The width a radio uses: its own, or on Auto the band's default narrowed to
 * the widest the region allows.
 */
export function radioTuning(radio: Radio, region: Plan['region']): Tuning {
  const allowed = channelWidths(region, radio.band)
  const auto = AUTO_WIDTH_MHZ[radio.band]
  const widthMHz =
    radio.channelWidthMHz ??
    allowed.filter((w) => w <= auto).at(-1) ??
    allowed[0] ??
    20
  return { channel: radio.channel, widthMHz }
}

/**
 * The share of an interferer's power that lands in a receiver's channel,
 * from 0 to 1 (D66): power is taken as spread evenly across the interferer's
 * channel, so the share is the overlap in MHz over its width. Either radio on
 * Auto counts as on a channel of its own, so 0.
 */
export function overlapShare(band: Band, receiver: Tuning, other: Tuning) {
  if (receiver.channel === undefined || other.channel === undefined) return 0
  const [a0, a1] = channelSpanMHz(band, receiver.channel, receiver.widthMHz)
  const [b0, b1] = channelSpanMHz(band, other.channel, other.widthMHz)
  const overlap = Math.min(a1, b1) - Math.max(a0, b0)
  return overlap > 0 ? overlap / other.widthMHz : 0
}

/**
 * Each coverage source's tuning, in the order of `accessPointIds`. `plan` is
 * the plan the coverage was worked out for, suggestion included.
 */
export function sourceTunings(
  coverage: Coverage,
  plan: Pick<Plan, 'accessPoints' | 'region'>,
): Tuning[] {
  return coverage.accessPointIds.map((id) => {
    const radio = plan.accessPoints
      .find((ap) => ap.id === id)
      ?.radios.find((r) => r.band === coverage.band)
    return radio
      ? radioTuning(radio, plan.region)
      : { channel: undefined, widthMHz: AUTO_WIDTH_MHZ[coverage.band] }
  })
}

/**
 * SINR in dB per cell, from the strongest access point in the cell (D61):
 * its signal over the other sources' power in its channel plus the noise
 * floor for its width. −Infinity where no access point reaches the cell.
 */
export function sinrDb(coverage: Coverage, tunings: readonly Tuning[]) {
  const size = coverage.dbm.length
  const sources = tunings.length
  // For each source as the one a device is on: who interferes, and how much.
  const interferers = tunings.map((receiver, s) =>
    tunings.flatMap((other, t) => {
      const share = t === s ? 0 : overlapShare(coverage.band, receiver, other)
      return share > 0 ? [{ t, share }] : []
    }),
  )
  const noiseMw = tunings.map((t) => 10 ** (noiseFloorDbm(t.widthMHz) / 10))
  const sinr = new Float32Array(size).fill(Number.NEGATIVE_INFINITY)
  for (let i = 0; i < size; i++) {
    const s = coverage.strongest[i]!
    if (s < 0 || s >= sources) continue
    let unwantedMw = noiseMw[s]!
    for (const { t, share } of interferers[s]!) {
      unwantedMw += share * 10 ** (coverage.sourceDbm[t * size + i]! / 10)
    }
    sinr[i] = coverage.dbm[i]! - 10 * Math.log10(unwantedMw)
  }
  return sinr
}

/**
 * How many sources are on Auto, so count as on a channel of their own. The
 * Interference view says so, since it's the best case.
 */
export function autoChannelCount(tunings: readonly Tuning[]): number {
  return tunings.filter((t) => t.channel === undefined).length
}
