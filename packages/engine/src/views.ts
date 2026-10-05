import type { Plan } from '@signalplan/floorplan'
import type { Coverage } from './coverage.ts'

/**
 * The Overlap and Roaming views (D61, D64). Both come from a coverage result,
 * so changing the margin or threshold doesn't need the engine to run again.
 */

/**
 * Below this a device looks for another access point: Apple's roam trigger for
 * iPhone and iPad (Apple Platform Deployment, "Wi-Fi roaming support in Apple
 * devices", 2024). Macs use −75 dBm. Where no access point reaches it, the
 * Roaming view shows a gap.
 */
export const DEFAULT_ROAM_THRESHOLD_DBM = -70

/**
 * Access points within this many dB of the strongest compete for a device:
 * the 8 dB an iPhone or iPad sending data needs before it switches (same
 * source; 12 dB when idle, and always on a Mac).
 */
export const DEFAULT_OVERLAP_MARGIN_DB = 8

export interface ViewSettings {
  overlapMarginDb: number
  roamThresholdDbm: number
}

/** A plan's view settings, with the defaults where it doesn't set them. */
export function viewSettings(
  plan: Pick<Plan, 'overlapMarginDb' | 'roamThresholdDbm'>,
): ViewSettings {
  return {
    overlapMarginDb: plan.overlapMarginDb ?? DEFAULT_OVERLAP_MARGIN_DB,
    roamThresholdDbm: plan.roamThresholdDbm ?? DEFAULT_ROAM_THRESHOLD_DBM,
  }
}

/**
 * How many access points compete for a device in each cell: those at or above
 * the roaming threshold and within the margin of the strongest. 0 where none
 * reaches the threshold.
 */
export function overlapCounts(
  coverage: Coverage,
  settings: ViewSettings,
): Uint8Array {
  const size = coverage.dbm.length
  const sources = coverage.accessPointIds.length
  const counts = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    const best = coverage.dbm[i]!
    if (!(best >= settings.roamThresholdDbm)) continue
    const floor = Math.max(
      settings.roamThresholdDbm,
      best - settings.overlapMarginDb,
    )
    let n = 0
    for (let s = 0; s < sources; s++) {
      if (coverage.sourceDbm[s * size + i]! >= floor) n++
    }
    counts[i] = Math.min(n, 255)
  }
  return counts
}

/**
 * Which access point a device would be on in each cell, as an index into
 * `accessPointIds`: the strongest, or −1 in a gap where none reaches the
 * roaming threshold.
 */
export function roamingOwners(
  coverage: Coverage,
  settings: ViewSettings,
): Int16Array {
  const owners = new Int16Array(coverage.dbm.length)
  coverage.dbm.forEach((dbm, i) => {
    owners[i] = dbm >= settings.roamThresholdDbm ? coverage.strongest[i]! : -1
  })
  return owners
}

/**
 * Cells on a line where a device would switch access points: those whose
 * right or lower neighbour is on a different one, neither being a gap.
 */
export function roamingEdges(owners: Int16Array, cols: number): Uint8Array {
  const edges = new Uint8Array(owners.length)
  const rows = cols === 0 ? 0 : owners.length / cols
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const own = owners[i]!
      if (own < 0) continue
      const right = col + 1 < cols ? owners[i + 1]! : -1
      const below = row + 1 < rows ? owners[i + cols]! : -1
      if ((right >= 0 && right !== own) || (below >= 0 && below !== own)) {
        edges[i] = 1
      }
    }
  }
  return edges
}

/**
 * Shares of the floor's area where two or more access points compete, and
 * where none reaches the roaming threshold, from 0 to 1. Undefined without
 * any floor area.
 */
export function viewShares(
  coverage: Coverage,
  counts: Uint8Array,
): { overlap: number; gaps: number } | undefined {
  let area = 0
  let overlap = 0
  let gaps = 0
  coverage.floorArea.forEach((inside, i) => {
    if (!inside) return
    area++
    if (counts[i]! >= 2) overlap++
    if (counts[i] === 0) gaps++
  })
  return area === 0 ? undefined : { overlap: overlap / area, gaps: gaps / area }
}
