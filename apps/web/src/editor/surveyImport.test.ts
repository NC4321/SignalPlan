import { describe, expect, it } from 'vitest'
import { importSummaryText } from './surveyImport.ts'

describe('importSummaryText (D72)', () => {
  const none = {
    readingsAdded: 0,
    readingsReplaced: 0,
    spotsAdded: 0,
    rowsSkipped: 0,
    bssidsMapped: 0,
  }

  it('says what was imported, added, replaced and skipped', () => {
    expect(
      importSummaryText({
        ...none,
        readingsAdded: 4,
        readingsReplaced: 1,
        spotsAdded: 2,
        rowsSkipped: 12,
      }),
    ).toBe(
      'Imported 5 readings, added 2 spots, replaced 1, skipped 12 rows from networks marked not mine.',
    )
    expect(importSummaryText({ ...none, readingsAdded: 1 })).toBe(
      'Imported 1 reading.',
    )
    expect(importSummaryText({ ...none, rowsSkipped: 1 })).toBe(
      'Imported no readings, skipped 1 row from networks marked not mine.',
    )
  })
})
