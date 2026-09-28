import { summariseCoverage, type Coverage } from '@signalplan/engine'
import type { Band, CoverageTarget } from '@signalplan/floorplan'
import { targetBand } from '../quality.ts'
import { formatArea, type Units } from './units.ts'

export const BAND_LABELS: Record<Band, string> = {
  '2.4GHz': '2.4 GHz',
  '5GHz': '5 GHz',
  '6GHz': '6 GHz',
}

/**
 * The coverage summary line (D27), e.g. "86% of 150 m² at Fair or better on
 * 5 GHz." Shares are rounded down, so 100% only ever means all of it.
 */
export function coverageMessage(
  coverage: Coverage,
  target: CoverageTarget | undefined,
  units: Units,
): string {
  const goal = targetBand(target)
  const { share, areaM2 } = summariseCoverage(coverage, goal.minDbm)
  return share === undefined
    ? 'Close the outer walls to see how much of the floor is covered.'
    : `${Math.floor(share * 100)}% of ${formatArea(areaM2, units)} at ${goal.label} or better on ${BAND_LABELS[coverage.band]}.`
}
