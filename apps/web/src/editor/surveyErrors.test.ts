import type { ReadingError, SpotError } from '@signalplan/engine'
import type { AccessPoint, SurveySpot } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  ERROR_RGB,
  errorLegendRows,
  errorStep,
  formatErrorDb,
  pinError,
  spotCardLines,
} from './surveyErrors.ts'

describe('errorStep', () => {
  it('bins whole-dB errors at 3, 6 and 10 dB either way', () => {
    const cases: [number, number][] = [
      [0, 3],
      [2, 3],
      [-2, 3],
      [3, 2],
      [5, 2],
      [6, 1],
      [9, 1],
      [10, 0],
      [25, 0],
      [-3, 4],
      [-6, 5],
      [-10, 6],
      [-40, 6],
    ]
    for (const [db, step] of cases) expect(errorStep(db), `${db}`).toBe(step)
  })

  it('rounds first, so the colour agrees with the whole-dB label', () => {
    // 2.6 dB reads "+3 dB", so it takes the +3 to +5 colour.
    expect(errorStep(2.6)).toBe(2)
    expect(errorStep(2.4)).toBe(3)
    expect(errorStep(-9.4)).toBe(5)
    expect(errorStep(-9.6)).toBe(6)
  })

  it('rounds halves away from zero, alike either way', () => {
    expect(errorStep(2.5)).toBe(2)
    expect(errorStep(-2.5)).toBe(4)
    expect(errorStep(-9.5)).toBe(6)
  })
})

describe('formatErrorDb', () => {
  it('signs with a true minus and never shows −0', () => {
    expect(formatErrorDb(4.24)).toBe('+4.2 dB')
    expect(formatErrorDb(-6)).toBe('−6.0 dB')
    expect(formatErrorDb(-0.04)).toBe('0.0 dB')
    expect(formatErrorDb(-3.6, 0)).toBe('−4 dB')
  })
})

describe('errorLegendRows', () => {
  it('lists the seven steps from too hopeful to too gloomy', () => {
    const rows = errorLegendRows()
    expect(rows.map((r) => r.label)).toEqual([
      '+10 dB or more',
      '+6 to +9 dB',
      '+3 to +5 dB',
      'Within ±2 dB',
      '−3 to −5 dB',
      '−6 to −9 dB',
      '−10 dB or less',
    ])
    expect(rows.map((r) => r.rgb)).toEqual(ERROR_RGB)
  })
})

describe('pinError', () => {
  const spots: SpotError[] = [
    { spotId: 's', floorId: 'f', band: '5GHz', count: 2, meanDb: -6.4 },
  ]

  it('labels and colours a pin with its mean error on the band', () => {
    expect(pinError(spots, 's', '5GHz')).toEqual({
      label: '−6 dB',
      rgb: ERROR_RGB[5],
    })
  })

  it('leaves a pin neutral with no readings on the band', () => {
    expect(pinError(spots, 's', '2.4GHz')).toEqual({
      label: '–',
      rgb: undefined,
    })
  })
})

describe('spotCardLines', () => {
  const spot: SurveySpot = {
    id: 's',
    x: 0,
    y: 0,
    readings: [
      { apId: 'a', band: '5GHz', dbm: -62 },
      { apId: 'b', band: '5GHz', dbm: -70.5 },
      { apId: 'a', band: '2.4GHz', dbm: -50 },
    ],
  }
  const aps = [
    { id: 'a', name: 'Router' },
    { id: 'b', name: 'Mesh' },
  ] as AccessPoint[]
  const error: ReadingError = {
    spotId: 's',
    floorId: 'f',
    index: 0,
    apId: 'a',
    band: '5GHz',
    measuredDbm: -62,
    approximate: false,
    predictedDbm: -57.84,
    errorDb: 4.16,
  }

  it('lists each reading on the band, or why it isn’t compared', () => {
    expect(spotCardLines(spot, '5GHz', [error], aps)).toEqual([
      'Router: measured −62.0 dBm, predicted −57.8 dBm (+4.2 dB)',
      'Mesh: measured −70.5 dBm, band turned off',
    ])
    expect(spotCardLines(spot, '6GHz', [error], aps)).toEqual([
      'No readings on this band',
    ])
  })

  it('marks an approximate reading with ≈ (D82)', () => {
    const rough: SurveySpot = {
      ...spot,
      readings: [{ ...spot.readings[0]!, approximate: true }],
    }
    expect(spotCardLines(rough, '5GHz', [error], aps)).toEqual([
      'Router: measured ≈−62.0 dBm, predicted −57.8 dBm (+4.2 dB)',
    ])
  })
})
