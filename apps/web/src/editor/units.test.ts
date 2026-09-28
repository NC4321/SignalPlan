import { describe, expect, it } from 'vitest'
import { formatArea, formatLength, parseLength } from './units.ts'

const inches = (n: number) => n * 0.0254
const feet = (n: number) => inches(n * 12)

describe('formatLength', () => {
  it('shows metres to two decimals', () => {
    expect(formatLength(3.456, 'metric')).toBe('3.46 m')
    expect(formatLength(0, 'metric')).toBe('0.00 m')
  })

  it('shows feet and inches to the nearest half inch', () => {
    expect(formatLength(feet(12) + inches(6.5), 'imperial')).toBe('12′ 6½″')
    expect(formatLength(feet(12) + inches(6.2), 'imperial')).toBe('12′ 6″')
    expect(formatLength(feet(3), 'imperial')).toBe('3′ 0″')
    expect(formatLength(inches(7.5), 'imperial')).toBe('7½″')
  })

  it('carries 12 inches into a foot', () => {
    expect(formatLength(feet(2) + inches(11.9), 'imperial')).toBe('3′ 0″')
  })
})

describe('formatArea', () => {
  it('rounds to whole square metres or square feet', () => {
    expect(formatArea(148.4, 'metric')).toBe('148 m²')
    // 100 m² is 100 / 0.09290304 = 1076.39 sq ft.
    expect(formatArea(100, 'imperial')).toBe('1,076 sq ft')
  })
})

describe('parseLength', () => {
  it.each([
    ['3.5', 3.5],
    ['3.5 m', 3.5],
    ['3.5m', 3.5],
    ['350 cm', 3.5],
    ['3500mm', 3.5],
    ['.5', 0.5],
  ])('reads metric "%s"', (text, metres) => {
    expect(parseLength(text, 'metric')).toBeCloseTo(metres, 9)
  })

  it.each([
    ['12', feet(12)],
    ['12.5', feet(12.5)],
    [`12'`, feet(12)],
    [`12.5'`, feet(12.5)],
    [`12'6.5"`, feet(12) + inches(6.5)],
    [`12' 6 1/2"`, feet(12) + inches(6.5)],
    [`12′ 6½″`.replace('½', ' 1/2'), feet(12) + inches(6.5)],
    [`150"`, inches(150)],
    [`1/2"`, inches(0.5)],
    ['12 ft 6 in', feet(12) + inches(6)],
    ['6 inches', inches(6)],
  ])('reads imperial "%s"', (text, metres) => {
    expect(parseLength(text, 'imperial')).toBeCloseTo(metres, 9)
  })

  it('accepts the other system when units are explicit', () => {
    expect(parseLength('2 m', 'imperial')).toBeCloseTo(2, 9)
    expect(parseLength(`10'`, 'metric')).toBeCloseTo(feet(10), 9)
  })

  it.each(['', 'abc', '3.5 km', `12'x`, `1/0"`, '-2', `"`, '1.2.3'])(
    'rejects "%s"',
    (text) => {
      expect(parseLength(text, 'metric')).toBeUndefined()
      expect(parseLength(text, 'imperial')).toBeUndefined()
    },
  )
})
