import type { ImportSummary } from '@signalplan/floorplan'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What an import did, for the status bar (D72). */
export function importSummaryText(summary: ImportSummary): string {
  const { readingsAdded, readingsReplaced, spotsAdded, rowsSkipped } = summary
  const readings = readingsAdded + readingsReplaced
  const parts = [
    readings === 0
      ? 'Imported no readings'
      : `Imported ${plural(readings, 'reading')}`,
  ]
  if (spotsAdded > 0) parts.push(`added ${plural(spotsAdded, 'spot')}`)
  if (readingsReplaced > 0) parts.push(`replaced ${readingsReplaced}`)
  if (rowsSkipped > 0) {
    parts.push(
      `skipped ${plural(rowsSkipped, 'row')} from networks marked not mine`,
    )
  }
  return `${parts.join(', ')}.`
}
