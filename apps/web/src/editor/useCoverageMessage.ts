import { useMemo } from 'react'
import { DEFAULT_TARGET } from '../quality.ts'
import { useEditor } from './context.ts'
import { mapMessage, type MapData } from '../mapView.ts'

/**
 * The summary line for the band and map on show (D27, D64), or '' when
 * nothing broadcasts on the band. Computed once and shared by the panel and status bar.
 */
export function useCoverageMessage(map: MapData | undefined): string {
  const target = useEditor((s) => s.plan.coverageTarget ?? DEFAULT_TARGET)
  const units = useEditor((s) => s.units)
  // Named only when there's more than one floor (D52).
  const floorName = useEditor((s) =>
    s.plan.floors.length > 1
      ? s.plan.floors.find((f) => f.id === s.floorId)?.name
      : undefined,
  )
  return useMemo(
    () => (map ? mapMessage(map, target, units, floorName) : ''),
    [map, target, units, floorName],
  )
}
