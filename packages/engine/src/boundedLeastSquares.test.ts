import { describe, expect, it } from 'vitest'
import { boundedLeastSquares } from './boundedLeastSquares.ts'
import { mulberry32 } from './multiSearch.ts'

const objective = (rows: number[][], b: number[], x: number[]) =>
  rows.reduce((sum, row, r) => {
    const residual = row.reduce((s, a, j) => s + a * x[j]!, 0) - b[r]!
    return sum + residual * residual
  }, 0)

describe('boundedLeastSquares', () => {
  it('fits a line exactly when the bounds are wide', () => {
    // y = 3 − 2t at t = 0, 1, 2, 3.
    const rows = [0, 1, 2, 3].map((t) => [1, t])
    const b = [3, 1, -1, -3]
    const x = boundedLeastSquares(rows, b, [-10, -10], [10, 10], [0, 0])
    expect(x[0]).toBeCloseTo(3, 9)
    expect(x[1]).toBeCloseTo(-2, 9)
  })

  it('stops at a bound and refits the rest (hand-worked)', () => {
    // Same line with the slope held to at least −1: the intercept is then
    // the mean of y + t = (3 + 2 + 1 + 0) / 4 = 1.5.
    const rows = [0, 1, 2, 3].map((t) => [1, t])
    const b = [3, 1, -1, -3]
    const x = boundedLeastSquares(rows, b, [-10, -1], [10, 10], [0, 0])
    expect(x[1]).toBe(-1)
    expect(x[0]).toBeCloseTo(1.5, 9)
  })

  it('leaves an unknown the rows never use at its start', () => {
    const x = boundedLeastSquares([[1, 0]], [4], [0, 0], [10, 10], [0, 7])
    expect(x[0]).toBeCloseTo(4, 9)
    expect(x[1]).toBe(7)
  })

  it('clamps the start into the bounds', () => {
    const x = boundedLeastSquares([[0, 0]], [1], [0, 2], [1, 3], [-5, 9])
    expect(x).toEqual([0, 3])
  })

  it('beats every point of a fine grid on random boxed problems', () => {
    const random = mulberry32(7)
    for (let trial = 0; trial < 40; trial++) {
      const rows = Array.from({ length: 6 }, () => [
        random() * 4 - 2,
        random() * 4 - 2,
      ])
      const b = rows.map(() => random() * 10 - 5)
      const lower = [random() * 2 - 2, random() * 2 - 2]
      const upper = [lower[0]! + random() * 2, lower[1]! + random() * 2]
      const x = boundedLeastSquares(rows, b, lower, upper, [0, 0])
      expect(x[0]).toBeGreaterThanOrEqual(lower[0]!)
      expect(x[0]).toBeLessThanOrEqual(upper[0]!)
      expect(x[1]).toBeGreaterThanOrEqual(lower[1]!)
      expect(x[1]).toBeLessThanOrEqual(upper[1]!)
      const best = objective(rows, b, x)
      for (let i = 0; i <= 40; i++) {
        for (let j = 0; j <= 40; j++) {
          const point = [
            lower[0]! + ((upper[0]! - lower[0]!) * i) / 40,
            lower[1]! + ((upper[1]! - lower[1]!) * j) / 40,
          ]
          expect(best).toBeLessThanOrEqual(objective(rows, b, point) + 1e-9)
        }
      }
    }
  })

  it('handles two unknowns that always appear together', () => {
    // Only their sum is known; any split within the bounds is a minimum.
    const rows = [
      [1, 1],
      [1, 1],
    ]
    const x = boundedLeastSquares(rows, [4, 4], [0, 0], [3, 3], [1, 1])
    expect(x[0]! + x[1]!).toBeCloseTo(4, 6)
  })
})
