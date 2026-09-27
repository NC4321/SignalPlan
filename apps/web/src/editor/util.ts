import type { Coverage } from '@signalplan/engine'
import type { Point } from '@signalplan/floorplan'

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The modifier shown in shortcut hints: ⌘ on Apple devices, Ctrl+ elsewhere. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl+'

/** Input types that accept typed text, where shortcuts must not fire. */
const TEXT_INPUTS = new Set([
  'text',
  'search',
  'number',
  'email',
  'url',
  'tel',
  'password',
])

/**
 * True when a key event comes from somewhere text is typed, where shortcuts
 * don't apply. Radio buttons and checkboxes don't count, so undo still works
 * right after picking an option.
 */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (!target) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)
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
