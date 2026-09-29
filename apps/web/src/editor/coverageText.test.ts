import type { Coverage } from '@signalplan/engine'
import { describe, expect, it } from 'vitest'
import { coverageMessage, settledAnnouncement } from './coverageText.ts'

/** Four 1 m² cells inside the walls, with the given signals. */
function coverage(dbm: number[], inside = [1, 1, 1, 1]): Coverage {
  return {
    grid: { originX: 0, originY: 0, cellM: 1, cols: 4, rows: 1 },
    band: '5GHz',
    dbm: Float32Array.from(dbm),
    strongest: new Int16Array(4),
    floorArea: Uint8Array.from(inside),
    accessPointIds: ['ap'],
    sourceDbm: Float32Array.from(dbm),
  }
}

describe('coverageMessage', () => {
  it('rounds the share down', () => {
    // Two of three cells reach −67: 66.7% shows as 66%.
    expect(
      coverageMessage(
        coverage([-50, -67, -80, -40], [1, 1, 1, 0]),
        undefined,
        'metric',
      ),
    ).toBe('66% of 3 m² at Fair or better on 5 GHz.')
  })

  it('uses the plan target', () => {
    expect(
      coverageMessage(coverage([-50, -67, -80, -40]), 'excellent', 'metric'),
    ).toBe('50% of 4 m² at Excellent or better on 5 GHz.')
  })

  it('names the floor when given one (D52)', () => {
    expect(
      coverageMessage(
        coverage([-50, -67, -80, -40]),
        undefined,
        'metric',
        'Upstairs',
      ),
    ).toBe('Upstairs: 75% of 4 m² at Fair or better on 5 GHz.')
  })

  it('asks for a closed outline when there is no floor area', () => {
    expect(
      coverageMessage(
        coverage([-50, -50, -50, -50], [0, 0, 0, 0]),
        undefined,
        'metric',
      ),
    ).toMatch(/^Close the outer walls/)
  })
})

describe('settledAnnouncement', () => {
  it('holds the last announcement while a drag is in progress', () => {
    expect(settledAnnouncement('86% …', '84% …', true)).toBe('86% …')
  })

  it('catches up once the drag ends', () => {
    expect(settledAnnouncement('86% …', '84% …', false)).toBe('84% …')
  })
})
