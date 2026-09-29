import type { Coverage } from '@signalplan/engine'
import type { Plan } from '@signalplan/floorplan'
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
/** The plan's access points, in a different order from the coverage's. */
const plan = {
  accessPoints: [
    { id: 'b', name: 'Upstairs' },
    { id: 'a', name: 'Router' },
  ] as Plan['accessPoints'],
}
const colours = (kind: 'signal' | 'overlap' | 'roaming') => {
  const data = mapData(row(), kind, settings, plan)
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

describe('mapData', () => {
  it('names access points in the coverage’s order, which sets their colours', () => {
    expect(mapData(row(), 'roaming', settings, plan).accessPointNames).toEqual([
      'Router',
      'Upstairs',
    ])
  })

  it('names access points only a suggestion adds (D64)', () => {
    // A suggested access point is in the shown plan, not the saved one.
    const coverage = { ...row(), accessPointIds: ['a', 'suggested'] }
    const shown = {
      accessPoints: [
        ...plan.accessPoints,
        { id: 'suggested', name: 'Access point 1' },
      ] as Plan['accessPoints'],
    }
    expect(
      mapData(coverage, 'roaming', settings, shown).accessPointNames,
    ).toEqual(['Router', 'Access point 1'])
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
      mapMessage(mapData(row(), 'overlap', settings, plan), 'fair', 'metric'),
    ).toBe('50% of 4 m² has two or more access points competing on 5 GHz.')
  })

  it('gives the share in gaps, rounded up so 0% means none', () => {
    // Inside: one gap cell of 4 → 25%. With a −80 threshold, none.
    expect(
      mapMessage(mapData(row(), 'roaming', settings, plan), 'fair', 'metric'),
    ).toBe('25% of 4 m² is a gap below -70 dBm on 5 GHz.')
    const low = { ...settings, roamThresholdDbm: -80 }
    expect(
      mapMessage(
        mapData(row(), 'roaming', low, plan),
        'fair',
        'metric',
        'Upstairs',
      ),
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
      mapMessage(mapData(big, 'roaming', settings, plan), 'fair', 'metric'),
    ).toBe('1% of 200 m² is a gap below -70 dBm on 5 GHz.')
  })

  it('asks for closed walls without floor area', () => {
    expect(
      mapMessage(
        mapData(row([0, 0, 0, 0, 0]), 'overlap', settings, plan),
        'fair',
        'metric',
      ),
    ).toMatch(/Close the outer walls/)
  })
})

describe('Interference (D66)', () => {
  /** Both access points on 5 GHz channel 36, or B moved to 44. */
  const tuned = (bChannel: number, bAuto = false) => ({
    region: 'US' as const,
    accessPoints: [
      {
        id: 'a',
        name: 'Router',
        radios: [{ band: '5GHz', channel: 36, channelWidthMHz: 20 }],
      },
      {
        id: 'b',
        name: 'Upstairs',
        radios: [
          bAuto
            ? { band: '5GHz' }
            : { band: '5GHz', channel: bChannel, channelWidthMHz: 20 },
        ],
      },
    ] as Plan['accessPoints'],
  })
  const interference = (p: ReturnType<typeof tuned>) =>
    mapData(row(), 'interference', settings, p)

  it('colours by the rate the SINR allows, hatching what no rate can use', () => {
    // Same channel, noise −90.97 dBm. Cell 0: −50 over −75 and the noise is
    // 24.9 dB, Medium. Cells 1–3: 6.0, 3.0 and 1.9 dB, all below the 9 dB
    // the slowest rate needs.
    const data = interference(tuned(36))
    const [medium, low1, low2, low3] = [0, 1, 2, 3].map((i) =>
      cellColour(data, i),
    )
    expect(data.sinr![0]).toBeCloseTo(24.89, 2)
    expect(medium).toEqual([0x3b, 0x52, 0x8b])
    expect(low1).toEqual([0xbd, 0xbd, 0xbd])
    expect(low2).toEqual([0xbd, 0xbd, 0xbd])
    expect(low3).toEqual([0xbd, 0xbd, 0xbd])
  })

  it('hears only noise with channels apart', () => {
    // Cell 0: −50 − (−90.97) = 41.0 dB, Fastest; cell 3: 19.0 dB, Slow.
    const data = interference(tuned(44))
    expect(cellColour(data, 0)).toEqual([0xfd, 0xe7, 0x25])
    expect(cellColour(data, 3)).toEqual([0x44, 0x01, 0x54])
  })

  it('leaves cells no access point reaches clear', () => {
    const coverage = row()
    coverage.dbm[4] = Number.NEGATIVE_INFINITY
    coverage.strongest[4] = -1
    const data = mapData(coverage, 'interference', settings, tuned(36))
    expect(cellColour(data, 4)).toBe('none')
  })

  it('gives the share too noisy for any rate, rounded up', () => {
    expect(mapMessage(interference(tuned(36)), 'fair', 'metric')).toBe(
      '75% of 4 m² is too noisy for any rate (below 9 dB) on 5 GHz.',
    )
    expect(mapMessage(interference(tuned(44)), 'fair', 'metric')).toBe(
      '0% of 4 m² is too noisy for any rate (below 9 dB) on 5 GHz.',
    )
  })

  it("doesn't count floor no access point reaches as too noisy", () => {
    // Cells 1–3 are below 9 dB with the same channel; with cell 3 out of
    // reach instead, 2 of the 4 floor cells are too noisy.
    const coverage = row()
    coverage.dbm[3] = Number.NEGATIVE_INFINITY
    coverage.strongest[3] = -1
    // A's signal in cell 3, then B's (B's cells start at 5).
    coverage.sourceDbm[3] = Number.NEGATIVE_INFINITY
    coverage.sourceDbm[8] = Number.NEGATIVE_INFINITY
    const data = mapData(coverage, 'interference', settings, tuned(36))
    expect(cellColour(data, 3)).toBe('none')
    expect(mapMessage(data, 'fair', 'metric')).toBe(
      '50% of 4 m² is too noisy for any rate (below 9 dB) on 5 GHz.',
    )
  })

  it('counts neighbours’ networks with a channel everywhere (D67)', () => {
    const p = {
      ...tuned(44),
      neighbourNetworks: [
        {
          id: 'n1',
          band: '5GHz',
          channel: 36,
          channelWidthMHz: 20,
          strengthDbm: -70,
        },
        { id: 'n2', band: '5GHz', channelWidthMHz: 20, strengthDbm: -40 },
      ] as Plan['neighbourNetworks'],
    }
    const data = interference(p)
    // Cell 0 is on A (channel 36): −50 − 10·log10(10^−7 + 10^−9.097) is
    // 19.97 dB, down from 41.0 dB, so Slow. B's channel 44 misses it.
    expect(data.sinr![0]).toBeCloseTo(19.97, 2)
    expect(cellColour(data, 0)).toEqual([0x44, 0x01, 0x54])
    // n2 has no channel yet, so only n1 counts.
    expect(data.neighbours).toBe(1)
    expect(
      mapLegend('interference', settings, [], 0, data.neighbours).note,
    ).toContain(
      '1 neighbour’s network counts everywhere at the strength typed in for it.',
    )
    expect(mapData(row(), 'signal', settings, p).neighbours).toBe(0)
  })

  it('names the bands in dB and says how many radios are on Auto', () => {
    const data = interference(tuned(36, true))
    expect(data.autoChannels).toBe(1)
    const legend = mapLegend('interference', settings, [], data.autoChannels)
    expect(legend.rows.map((r) => [r.label, r.detail])).toEqual([
      ['Fastest', '≥ 39 dB'],
      ['Very fast', '34 to 39 dB'],
      ['Fast', '27 to 34 dB'],
      ['Medium', '21 to 27 dB'],
      ['Slow', '9 to 21 dB'],
      ['Unusable', '< 9 dB'],
      ['No signal', ''],
    ])
    expect(legend.note).toMatch(/1 access point has its channel on Auto/)
    expect(mapLegend('interference', settings, [], 0).note).not.toMatch(/Auto/)
  })
})
