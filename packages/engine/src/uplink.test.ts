import type { Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES } from './bands.ts'
import { evaluateCoverage, type Coverage } from './coverage.ts'
import { ap, twoStoreyHouse } from './testPlans.ts'
import {
  PHONE_EIRP_DBM,
  sourceEirps,
  uplinkDbm,
  uplinkShares,
} from './uplink.ts'

/**
 * One row of five cells and two access points: A at 23 dBm, B at 17 dBm,
 * the strongest marked (the same row as in `views.test.ts`):
 *
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
    neighbourIds: [],
    neighbourDbm: new Float32Array(0),
  }
}

const twoAps: Pick<Plan, 'accessPoints'> = {
  accessPoints: [
    { ...ap(0, 0), id: 'a', radios: [{ band: '5GHz' }] },
    { ...ap(4, 0), id: 'b', radios: [{ band: '5GHz', txPowerDbm: 17 }] },
  ],
}

describe('PHONE_EIRP_DBM', () => {
  it('is pinned to the sourced values (MODEL.md, Upload)', () => {
    expect(PHONE_EIRP_DBM).toEqual({ '2.4GHz': 14, '5GHz': 10, '6GHz': 12 })
  })

  it('on 6 GHz is the client limit of −1 dBm/MHz over 20 MHz, 6 dB under the access point', () => {
    const client = -1 + 10 * Math.log10(20)
    expect(client).toBeCloseTo(12.0, 1)
    expect(Math.round(client)).toBe(PHONE_EIRP_DBM['6GHz'])
    expect(
      BAND_PROFILES['6GHz'].defaultTxPowerDbm - PHONE_EIRP_DBM['6GHz'],
    ).toBe(6)
  })

  it('is below every band’s default access point power', () => {
    for (const band of ['2.4GHz', '5GHz', '6GHz'] as const) {
      expect(PHONE_EIRP_DBM[band]).toBeLessThan(
        BAND_PROFILES[band].defaultTxPowerDbm,
      )
    }
  })
})

describe('sourceEirps', () => {
  it('takes each radio’s power, or the band’s default', () => {
    expect(sourceEirps(row(), twoAps)).toEqual([23, 17])
  })
})

describe('uplinkDbm', () => {
  it('is the signal less the access point’s EIRP plus the phone’s, from the access point a phone is on', () => {
    // A at 23 dBm: 13 dB down at 10 dBm. B at 17 dBm: 7 dB down.
    //   −50 − 13 = −63, −60 − 13 = −73, −62 − 7 = −69 (B), −72 − 13 = −85,
    //   −80 − 13 = −93.
    expect([...uplinkDbm(row(), twoAps)]).toEqual([-63, -73, -69, -85, -93])
  })

  it('takes another phone power', () => {
    expect([...uplinkDbm(row(), twoAps, 14)]).toEqual([-59, -69, -65, -81, -89])
  })

  it('is −Infinity where no access point reaches', () => {
    const coverage = row()
    coverage.dbm[4] = Number.NEGATIVE_INFINITY
    coverage.strongest[4] = -1
    expect(uplinkDbm(coverage, twoAps)[4]).toBe(Number.NEGATIVE_INFINITY)
  })

  it('works a cell out by hand: 4 m from a 23 dBm access point on 5 GHz', () => {
    const plan: Plan = {
      schemaVersion: 1,
      name: 'Open',
      floors: [
        {
          id: 'f',
          name: 'Floor',
          elevationM: 0,
          heightM: 2.5,
          nodes: [],
          walls: [],
          openings: [],
        },
      ],
      accessPoints: [ap(0.05, 0.05)],
    }
    const coverage = evaluateCoverage(plan, 'f', '5GHz')
    // The cell centred 4 m east of the access point, at receiver height (a
    // floor with no walls reaches 5 m around it).
    const { grid } = coverage
    const col = Math.round((4.05 - grid.originX) / grid.cellM - 0.5)
    const row0 = Math.round((0.05 - grid.originY) / grid.cellM - 0.5)
    const i = row0 * grid.cols + col
    // PL(1 m) on 5 GHz is 47.3 dB, and 4 m adds 20·log10(4) = 12.0 dB:
    // 59.3 dB either way.
    const loss = BAND_PROFILES['5GHz'].referenceLossDb + 20 * Math.log10(4)
    expect(loss).toBeCloseTo(59.3, 1)
    expect(coverage.dbm[i]).toBeCloseTo(23 - loss, 4) // −36.3 dBm down
    expect(uplinkDbm(coverage, plan)[i]).toBeCloseTo(10 - loss, 4) // −49.3 up
  })

  it('follows the access point across floors, slabs and walls included', () => {
    const plan = twoStoreyHouse()
    const upstairs = plan.floors[1]!.id
    const coverage = evaluateCoverage(plan, upstairs, '2.4GHz', 0.5)
    const eirps = sourceEirps(coverage, plan)
    const uplink = uplinkDbm(coverage, plan)
    coverage.dbm.forEach((dbm, i) => {
      const s = coverage.strongest[i]!
      if (s < 0) return
      expect(uplink[i]).toBeCloseTo(dbm - eirps[s]! + 14, 4)
    })
  })
})

describe('uplinkShares', () => {
  it('gives where upload reaches the target, and where only download does', () => {
    // Floor area is the first four cells. At −67 dBm: download reaches cells
    // 0, 1 and 2; upload (−63, −73, −69, −85) only cell 0.
    const coverage = row()
    const shares = uplinkShares(coverage, uplinkDbm(coverage, twoAps), -67)
    expect(shares).toEqual({ reached: 1 / 4, downloadOnly: 2 / 4 })
  })

  it('is undefined without any floor area', () => {
    const coverage = { ...row(), floorArea: new Uint8Array(5) }
    expect(
      uplinkShares(coverage, uplinkDbm(coverage, twoAps), -67),
    ).toBeUndefined()
  })
})
