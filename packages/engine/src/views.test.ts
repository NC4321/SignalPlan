import { describe, expect, it } from 'vitest'
import { evaluateCoverage, type Coverage } from './coverage.ts'
import {
  DEFAULT_OVERLAP_MARGIN_DB,
  DEFAULT_ROAM_THRESHOLD_DBM,
  overlapCounts,
  roamingEdges,
  roamingOwners,
  viewSettings,
  viewShares,
} from './views.ts'
import { twoStoreyHouse } from './testPlans.ts'

/**
 * One row of five cells and two access points, A and B:
 *
 *   A:     −50  −60  −65  −72  −80
 *   B:     −75  −66  −62  −74  −90
 *   best:  −50  −60  −62  −72  −80   (A, A, B, A, A)
 */
function row(): Coverage {
  const a = [-50, -60, -65, -72, -80]
  const b = [-75, -66, -62, -74, -90]
  return {
    grid: { originX: 0, originY: 0, cellM: 1, cols: 5, rows: 1 },
    band: '5GHz',
    dbm: Float32Array.from(a.map((v, i) => Math.max(v, b[i]!))),
    strongest: Int16Array.from(a.map((v, i) => (v >= b[i]! ? 0 : 1))),
    floorArea: Uint8Array.from([1, 1, 1, 1, 0]),
    accessPointIds: ['a', 'b'],
    sourceDbm: Float32Array.from([...a, ...b]),
  }
}

const defaults = {
  overlapMarginDb: DEFAULT_OVERLAP_MARGIN_DB,
  roamThresholdDbm: DEFAULT_ROAM_THRESHOLD_DBM,
}

describe('defaults', () => {
  it('follow Apple’s iPhone and iPad roaming rules', () => {
    expect(DEFAULT_ROAM_THRESHOLD_DBM).toBe(-70)
    expect(DEFAULT_OVERLAP_MARGIN_DB).toBe(8)
  })
})

describe('viewSettings', () => {
  it('takes the plan’s settings, or the defaults', () => {
    const plan = twoStoreyHouse()
    expect(viewSettings(plan)).toEqual(defaults)
    expect(
      viewSettings({ ...plan, overlapMarginDb: 12, roamThresholdDbm: -75 }),
    ).toEqual({ overlapMarginDb: 12, roamThresholdDbm: -75 })
  })
})

describe('overlapCounts', () => {
  it('counts access points within the margin and above the threshold', () => {
    // Cell 0: B is 25 dB down. Cells 1 and 2: the other is 6 and 3 dB down,
    // both above −70. Cells 3 and 4: the best is below −70.
    expect([...overlapCounts(row(), defaults)]).toEqual([1, 2, 2, 0, 0])
  })

  it('follows the margin and threshold', () => {
    // At −75 dBm and 12 dB, cell 3 has A at −72 and B at −74, both counted;
    // cell 0 still has B 25 dB down.
    expect([
      ...overlapCounts(row(), { overlapMarginDb: 12, roamThresholdDbm: -75 }),
    ]).toEqual([1, 2, 2, 2, 0])
    // A 5 dB margin drops B at cell 1 (6 dB down) but keeps A at cell 2 (3 dB).
    expect([
      ...overlapCounts(row(), { overlapMarginDb: 5, roamThresholdDbm: -70 }),
    ]).toEqual([1, 1, 2, 0, 0])
  })
})

describe('roamingOwners and roamingEdges', () => {
  it('puts each cell on its strongest access point, with gaps below the threshold', () => {
    const owners = roamingOwners(row(), defaults)
    expect([...owners]).toEqual([0, 0, 1, -1, -1])
    // A switch between cells 1 and 2; none next to a gap.
    expect([...roamingEdges(owners, 5)]).toEqual([0, 1, 0, 0, 0])
  })

  it('finds switches between rows too', () => {
    // 2 × 2: A on top, B below-left, a gap below-right.
    const owners = Int16Array.from([0, 0, 1, -1])
    expect([...roamingEdges(owners, 2)]).toEqual([1, 0, 0, 0])
  })
})

describe('viewShares', () => {
  it('gives overlap and gap shares of the floor area', () => {
    // Inside: counts 1, 2, 2, 0; cell 4 is outside.
    const counts = overlapCounts(row(), defaults)
    expect(viewShares(row(), counts)).toEqual({ overlap: 0.5, gaps: 0.25 })
  })

  it('has nothing to say without floor area', () => {
    const coverage = { ...row(), floorArea: new Uint8Array(5) }
    expect(viewShares(coverage, new Uint8Array(5))).toBeUndefined()
  })
})

describe('evaluateCoverage', () => {
  it('keeps each access point’s signal, whose maximum is the cell’s', () => {
    // Two access points, one per floor, so both reach every cell.
    const plan = twoStoreyHouse()
    const coverage = evaluateCoverage(plan, 'up', '5GHz', 0.5)
    expect(coverage.accessPointIds).toHaveLength(2)
    const size = coverage.dbm.length
    expect(coverage.sourceDbm).toHaveLength(
      size * coverage.accessPointIds.length,
    )
    for (let i = 0; i < size; i++) {
      let best = Number.NEGATIVE_INFINITY
      for (let s = 0; s < coverage.accessPointIds.length; s++) {
        best = Math.max(best, coverage.sourceDbm[s * size + i]!)
      }
      expect(best).toBe(coverage.dbm[i])
    }
  })
})
