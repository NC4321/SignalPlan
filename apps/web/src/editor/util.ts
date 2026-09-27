import type { Coverage } from '@signalplan/engine'
import type { Point } from '@signalplan/floorplan'

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The modifier shown in shortcut hints: ⌘ on Apple devices, Ctrl+ elsewhere. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl+'

/** True when a key event comes from a text field, where shortcuts don't apply. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return (
    !!target &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/** Predicted signal in the coverage cell under a point, if any. */
export function signalAt(coverage: Coverage, p: Point): number | undefined {
  const { grid } = coverage
  const col = Math.floor((p.x - grid.originX) / grid.cellM)
  const row = Math.floor((p.y - grid.originY) / grid.cellM)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
    return undefined
  }
  const value = coverage.dbm[row * grid.cols + col]
  return value === undefined || value === -Infinity ? undefined : value
}
