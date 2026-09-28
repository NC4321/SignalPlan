import { describe, expect, it } from 'vitest'
import { COVERAGE_TARGETS } from '@signalplan/floorplan'
import { QUALITY_BANDS, qualityOf, targetBand } from './quality.ts'

describe('qualityOf', () => {
  it('puts each threshold in its own band', () => {
    expect(qualityOf(-50)?.label).toBe('Excellent')
    expect(qualityOf(-50.1)?.label).toBe('Good')
    expect(qualityOf(-67)?.label).toBe('Fair')
    expect(qualityOf(-67.1)?.label).toBe('Weak')
    expect(qualityOf(-85)?.label).toBe('Poor')
  })

  it('has no band below the weakest threshold', () => {
    expect(qualityOf(-85.1)).toBeUndefined()
    expect(qualityOf(-Infinity)).toBeUndefined()
  })

  it('lists bands from strongest to weakest', () => {
    const thresholds = QUALITY_BANDS.map((band) => band.minDbm)
    expect(thresholds).toEqual([...thresholds].sort((a, b) => b - a))
  })
})

describe('targetBand', () => {
  it('names a heatmap band for every target', () => {
    expect(COVERAGE_TARGETS.map((t) => targetBand(t).minDbm)).toEqual([
      -50, -60, -67, -75,
    ])
  })

  it('defaults to Fair, calls and streaming', () => {
    expect(targetBand().label).toBe('Fair')
  })
})
