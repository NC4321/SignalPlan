import type { Coverage } from '@signalplan/engine'
import { describe, expect, it } from 'vitest'
import { cellColour, mapData, mapLegend, mapMessage } from './mapView.ts'

/**
 * One row of five 1 m² cells and two access points, A and B, as in the
 * engine's view tests:
 *
 *   A:     −50  −60  −65  −72  −80
 *   B:     −75  −66  −62  −74  −90
 *   best:  −50  −60  −62  −72  −80   (A, A, B, A, A)
 */
function row(inside = [1, 1, 1, 1, 0]): Coverage {
  const a = [-50, -60, -65, -72, -80]
  const b = [-75, -66, -62, -74, -90]
  return {
    grid: { originX: 0, originY: 0, cellM: 1, cols: 5, rows: 1 },
    band: '5GHz',
    dbm: Float32Array.from(a.map((v, i) => Math.max(v, b[i]!))),
    strongest: Int16Array.from(a.map((v, i) => (v >= b[i]! ? 0 : 1))),
    floorArea: Uint8Array.from(inside),
    accessPointIds: ['a', 'b'],
    sourceDbm: Float32Array.from([...a, ...b]),
  }
}

const settings = { overlapMarginDb: 8, roamThresholdDbm: -70 }
const colours = (kind: 'signal' | 'overlap' | 'roaming') => {
  const data = mapData(row(), kind, settings)
  return [0, 1, 2, 3, 4].map((i) => cellColour(data, i))
}

describe('cellColour', () => {
  it('colours Signal by quality band', () => {
    // −50 is Excellent, −80 is Poor; nothing here is below −85.
    const [first, , , , last] = colours('signal')
    expect(first).toEqual([0xfd, 0xe7, 0x25])
    expect(last).toEqual([0x44, 0x01, 0x54])
  })

  it('colours Overlap by count, and nothing where none is usable', () => {
    // Counts 1, 2, 2, 0, 0.
    const [one, two, alsoTwo, none, alsoNone] = colours('overlap')
    expect(one).not.toEqual(two)
    expect(two).toEqual(alsoTwo)
    expect(none).toBe('none')
    expect(alsoNone).toBe('none')
  })

  it('colours Roaming by access point, with switch lines and hatched gaps', () => {
    // Owners A, A, B, gap, gap; the switch is on cell 1.
    const [a, edge, b, gap1, gap2] = colours('roaming')
    expect(a).toEqual([0xe6, 0x9f, 0x00])
    expect(edge).toEqual([0x1a, 0x1a, 0x1a])
    expect(b).toEqual([0x56, 0xb4, 0xe9])
    // Cell 4 is on every fourth diagonal, so it's the darker hatch.
    expect(gap1).toEqual([0xbd, 0xbd, 0xbd])
    expect(gap2).toEqual([0x73, 0x73, 0x73])
  })
})

describe('mapLegend', () => {
  it('names each access point for Roaming, then switches and gaps', () => {
    const legend = mapLegend('roaming', settings, ['Router', 'Upstairs'])
    expect(legend.rows.map((r) => r.label)).toEqual([
      'Router',
      'Upstairs',
      'Switch',
      'Gap',
    ])
    expect(legend.rows.at(-1)?.detail).toBe('< -70 dBm')
  })

  it('says how Overlap counts, with the plan’s settings', () => {
    const legend = mapLegend(
      'overlap',
      { overlapMarginDb: 12, roamThresholdDbm: -75 },
      [],
    )
    expect(legend.note).toBe(
      'Counts access points within 12 dB of the strongest and at least -75 dBm.',
    )
  })
})

describe('mapMessage', () => {
  it('gives the share with competing access points, rounded up', () => {
    // Inside: counts 1, 2, 2, 0 → 2 of 4 m².
    expect(
      mapMessage(mapData(row(), 'overlap', settings), 'fair', 'metric'),
    ).toBe('50% of 4 m² has two or more access points competing on 5 GHz.')
  })

  it('gives the share in gaps, rounded up so 0% means none', () => {
    // Inside: one gap cell of 4 → 25%. With a −80 threshold, none.
    expect(
      mapMessage(mapData(row(), 'roaming', settings), 'fair', 'metric'),
    ).toBe('25% of 4 m² is a gap below -70 dBm on 5 GHz.')
    const low = { ...settings, roamThresholdDbm: -80 }
    expect(
      mapMessage(mapData(row(), 'roaming', low), 'fair', 'metric', 'Upstairs'),
    ).toBe('Upstairs: 0% of 4 m² is a gap below -80 dBm on 5 GHz.')
  })

  it('rounds a small gap up to 1%', () => {
    // One gap cell in 200.
    const coverage = row()
    const big: Coverage = {
      ...coverage,
      grid: { ...coverage.grid, cols: 200 },
      dbm: new Float32Array(200).fill(-50),
      strongest: new Int16Array(200),
      floorArea: new Uint8Array(200).fill(1),
      accessPointIds: ['a'],
      sourceDbm: new Float32Array(200).fill(-50),
    }
    big.dbm[0] = -90
    big.sourceDbm[0] = -90
    expect(
      mapMessage(mapData(big, 'roaming', settings), 'fair', 'metric'),
    ).toBe('1% of 200 m² is a gap below -70 dBm on 5 GHz.')
  })

  it('asks for closed walls without floor area', () => {
    expect(
      mapMessage(
        mapData(row([0, 0, 0, 0, 0]), 'overlap', settings),
        'fair',
        'metric',
      ),
    ).toMatch(/Close the outer walls/)
  })
})
