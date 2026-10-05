import type { Band, Plan } from '@signalplan/floorplan'
import { BAND_PROFILES } from './bands.ts'
import type { Coverage } from './coverage.ts'

/**
 * The phone → access point direction, upload (D99, docs/MODEL.md "Upload").
 *
 * Path loss is the same both ways, so the access point receives the phone at
 * the phone's EIRP less the same loss the heatmap works out. A phone sends
 * at much less power than a router, so upload falls short before download.
 * Worked out from a coverage result, so it costs one subtraction per cell and
 * no second run of the engine.
 */

/**
 * A phone's Wi-Fi EIRP, in dBm, per band. Antenna gain counts as 0 dBi, as
 * the heatmap's receiver does, so conducted power and EIRP are the same.
 * - 2.4 GHz: 14 dBm, the top of the 9–14 dBm range Cisco gives as the
 *   typical maximum for most iOS devices, "depending on the model and AP
 *   channel" (Enterprise Best Practices for iOS, iPadOS and macOS devices on
 *   Cisco Wireless LAN). Sârbu et al. (2020) give 16 dBm conducted for
 *   phones on 802.11n from FCC filings; the lower of the two is used.
 * - 5 GHz: 10 dBm, Sârbu et al.'s figure for phones on 802.11ac, inside
 *   Cisco's range.
 * - 6 GHz: 12 dBm, the FCC limit for a client of a low-power indoor access
 *   point (−1 dBm/MHz, 47 CFR § 15.407(a)(8)) over the 20 MHz the access
 *   point's default assumes, 6 dB below it.
 */
export const PHONE_EIRP_DBM: Readonly<Record<Band, number>> = {
  '2.4GHz': 14,
  '5GHz': 10,
  '6GHz': 12,
}

/**
 * The access point's EIRP on the coverage's band, per source, in the order
 * of `accessPointIds`: its radio's power, or the band's default.
 */
export function sourceEirps(
  coverage: Coverage,
  plan: Pick<Plan, 'accessPoints'>,
): number[] {
  const fallback = BAND_PROFILES[coverage.band].defaultTxPowerDbm
  return coverage.accessPointIds.map((id) => {
    const radio = plan.accessPoints
      .find((ap) => ap.id === id)
      ?.radios.find((r) => r.band === coverage.band)
    return radio?.txPowerDbm ?? fallback
  })
}

/**
 * The phone's signal at the access point it's on, in dBm per cell: the
 * strongest access point, as in the Roaming and Interference views, at the
 * phone's EIRP less the path loss to it. So it's the heatmap's value less
 * the access point's EIRP plus the phone's. The access point's receive
 * antenna counts as 0 dBi and only one of its antennas is counted (D24).
 * −Infinity where no access point reaches.
 */
export function uplinkDbm(
  coverage: Coverage,
  plan: Pick<Plan, 'accessPoints'>,
  phoneEirpDbm = PHONE_EIRP_DBM[coverage.band],
): Float32Array {
  const gaps = sourceEirps(coverage, plan).map((eirp) => eirp - phoneEirpDbm)
  const { dbm, strongest } = coverage
  const out = new Float32Array(dbm.length).fill(Number.NEGATIVE_INFINITY)
  for (let i = 0; i < dbm.length; i++) {
    const source = strongest[i]!
    if (source >= 0) out[i] = dbm[i]! - gaps[source]!
  }
  return out
}

/**
 * Shares of the floor's area, from 0 to 1, where upload reaches `minDbm`,
 * and where download does but upload doesn't. Undefined without any floor
 * area.
 */
export function uplinkShares(
  coverage: Coverage,
  uplink: Float32Array,
  minDbm: number,
): { reached: number; downloadOnly: number } | undefined {
  let area = 0
  let reached = 0
  let downloadOnly = 0
  coverage.floorArea.forEach((inside, i) => {
    if (!inside) return
    area++
    if (uplink[i]! >= minDbm) reached++
    else if (coverage.dbm[i]! >= minDbm) downloadOnly++
  })
  return area === 0
    ? undefined
    : { reached: reached / area, downloadOnly: downloadOnly / area }
}
