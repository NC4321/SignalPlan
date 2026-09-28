import type { Coverage } from '@signalplan/engine'
import { useMemo } from 'react'
import { DEFAULT_TARGET } from '../quality.ts'
import { useEditor } from './context.ts'
import { coverageMessage } from './coverageText.ts'

/**
 * The coverage summary line for the band on show, or '' when nothing
 * broadcasts on it. Computed once and shared by the panel and status bar.
 */
export function useCoverageMessage(coverage: Coverage | undefined): string {
  const target = useEditor((s) => s.plan.coverageTarget ?? DEFAULT_TARGET)
  const units = useEditor((s) => s.units)
  return useMemo(
    () => (coverage ? coverageMessage(coverage, target, units) : ''),
    [coverage, target, units],
  )
}
