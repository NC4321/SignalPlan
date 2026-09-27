import { describe, expect, it } from 'vitest'
import { freeSpacePathLoss } from './pathLoss.ts'

describe('freeSpacePathLoss', () => {
  // 1 m reference losses quoted in docs/OUTLINE.md (Phase 2).
  it.each([
    [2.437e9, 40.2],
    [5.18e9, 46.7],
    [6.0e9, 48.0],
  ])('at 1 m and %s Hz is about %s dB', (frequencyHz, expectedDb) => {
    expect(freeSpacePathLoss(1, frequencyHz)).toBeCloseTo(expectedDb, 1)
  })

  it('adds 20 dB per decade of distance', () => {
    const f = 2.4e9
    expect(freeSpacePathLoss(10, f) - freeSpacePathLoss(1, f)).toBeCloseTo(
      20,
      9,
    )
  })

  it('rejects non-positive inputs', () => {
    expect(() => freeSpacePathLoss(0, 2.4e9)).toThrow(RangeError)
    expect(() => freeSpacePathLoss(1, -1)).toThrow(RangeError)
    expect(() => freeSpacePathLoss(Number.NaN, 2.4e9)).toThrow(RangeError)
  })
})
