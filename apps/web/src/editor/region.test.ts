import { describe, expect, it } from 'vitest'
import { blankPlan, samplePlan } from './persistence.ts'
import { guessRegion, regionPlace } from './region.ts'

describe('guessRegion', () => {
  it('decides from the first language, filling in its likely country', () => {
    expect(guessRegion(['en-US'])).toBe('US')
    expect(guessRegion(['de-DE', 'en-US'])).toBe('EU')
    expect(guessRegion(['fr', 'fr-FR'])).toBe('EU')
    // A German Firefox lists a bare language before its English fallback.
    expect(guessRegion(['de', 'en-US', 'en'])).toBe('EU')
    expect(guessRegion(['en'])).toBe('US')
    // A Canadian with French from France as a second language stays US.
    expect(guessRegion(['en-CA', 'fr-FR'])).toBe('US')
  })

  it('falls back to the US outside the US and EU', () => {
    expect(guessRegion(['en-GB'])).toBe('US')
    expect(guessRegion(['de-CH'])).toBe('US')
    expect(guessRegion(['ja'])).toBe('US')
    expect(guessRegion([])).toBe('US')
    expect(guessRegion(['not a tag!'])).toBe('US')
  })
})

describe('new plans', () => {
  it('follow the region they are given', () => {
    expect(blankPlan('EU').region).toBe('EU')
    expect(samplePlan('EU').region).toBe('EU')
    expect(samplePlan('US').region).toBe('US')
  })
})

describe('regionPlace', () => {
  it('reads after “in”', () => {
    expect(regionPlace('EU')).toBe('the EU')
    expect(regionPlace(undefined)).toBe('the US')
  })
})
