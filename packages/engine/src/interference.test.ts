import type { Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { evaluateCoverage, type Coverage } from './coverage.ts'
import {
  autoChannelCount,
  noiseFloorDbm,
  overlapShare,
  radioTuning,
  requiredSinrDb,
  sinrDb,
  sourceTunings,
  type Tuning,
} from './interference.ts'
import { twoStoreyHouse } from './testPlans.ts'

/**
 * One row of three cells and two access points, A and B:
 *
 *   A:     −50  −60  −90
 *   B:     −60  −50  −95
 *   best:  −50  −50  −90   (A, B, A)
 */
function row(): Coverage {
  const a = [-50, -60, -90]
  const b = [-60, -50, -95]
  return {
    grid: { originX: 0, originY: 0, cellM: 1, cols: 3, rows: 1 },
    band: '5GHz',
    dbm: Float32Array.from(a.map((v, i) => Math.max(v, b[i]!))),
    strongest: Int16Array.from(a.map((v, i) => (v >= b[i]! ? 0 : 1))),
    floorArea: Uint8Array.from([1, 1, 1]),
    accessPointIds: ['a', 'b'],
    sourceDbm: Float32Array.from([...a, ...b]),
  }
}

const on = (channel: number | undefined, widthMHz: Tuning['widthMHz']) => ({
  channel,
  widthMHz,
})

describe('noise floor', () => {
  it('is kT₀B plus a 10 dB noise figure', () => {
    // −173.98 + 10·log10(20 × 10⁶) + 10 = −173.98 + 73.01 + 10
    expect(noiseFloorDbm(20)).toBeCloseTo(-90.97, 2)
    // Each doubling of width adds 3.01 dB: 80 MHz is 6.02 dB noisier.
    expect(noiseFloorDbm(80) - noiseFloorDbm(20)).toBeCloseTo(6.02, 2)
  })

  it('gives the SINR each rate needs from the 802.11 sensitivities', () => {
    // −82 − (−90.97), and so on.
    expect(requiredSinrDb('mcs0')).toBeCloseTo(8.97, 2)
    expect(requiredSinrDb('mcs4')).toBeCloseTo(20.97, 2)
    expect(requiredSinrDb('mcs7')).toBeCloseTo(26.97, 2)
    expect(requiredSinrDb('mcs9')).toBeCloseTo(33.97, 2)
    expect(requiredSinrDb('mcs11')).toBeCloseTo(38.97, 2)
  })
})

describe('overlapShare', () => {
  it('counts the whole of a same-channel neighbour', () => {
    expect(overlapShare('5GHz', on(36, 20), on(36, 20))).toBe(1)
  })

  it('counts nothing from a channel that does not overlap', () => {
    // 2.4 GHz channels 1 and 6: 2402–2422 and 2427–2447 MHz.
    expect(overlapShare('2.4GHz', on(1, 20), on(6, 20))).toBe(0)
    // 5 GHz channels 36 and 40 only touch, at 5190 MHz.
    expect(overlapShare('5GHz', on(36, 20), on(40, 20))).toBe(0)
  })

  it('counts half of a 2.4 GHz channel two away', () => {
    // Channel 1 is 2402–2422 MHz and channel 3 2412–2432: 10 of 20 MHz.
    expect(overlapShare('2.4GHz', on(1, 20), on(3, 20))).toBe(0.5)
  })

  it('counts the share of a wider channel that lands in a narrower one', () => {
    // 40 MHz channel 38 is 5170–5210 MHz, 80 MHz channel 42 5170–5250.
    expect(overlapShare('5GHz', on(38, 40), on(42, 80))).toBe(0.5)
    expect(overlapShare('5GHz', on(42, 80), on(38, 40))).toBe(1)
  })

  it('counts nothing when either radio is on Auto', () => {
    expect(overlapShare('5GHz', on(undefined, 80), on(42, 80))).toBe(0)
    expect(overlapShare('5GHz', on(42, 80), on(undefined, 80))).toBe(0)
  })
})

describe('radioTuning', () => {
  it('keeps a width set by hand', () => {
    const radio = { band: '5GHz', channel: 36, channelWidthMHz: 20 } as const
    expect(radioTuning(radio, 'US')).toEqual(on(36, 20))
  })

  it('takes the band default on Auto, narrowed to what the region allows', () => {
    expect(radioTuning({ band: '5GHz' }, 'US')).toEqual(on(undefined, 80))
    expect(radioTuning({ band: '6GHz' }, 'EU')).toEqual(on(undefined, 80))
    expect(radioTuning({ band: '2.4GHz' }, undefined)).toEqual(
      on(undefined, 20),
    )
  })
})

describe('sinrDb', () => {
  it('is signal over noise alone with channels apart', () => {
    const sinr = sinrDb(row(), [on(36, 20), on(44, 20)])
    // −50 − (−90.97)
    expect(sinr[0]).toBeCloseTo(40.97, 2)
    expect(sinr[1]).toBeCloseTo(40.97, 2)
    // −90 − (−90.97): barely above the noise.
    expect(sinr[2]).toBeCloseTo(0.97, 2)
  })

  it('adds a same-channel neighbour to the noise', () => {
    const sinr = sinrDb(row(), [on(36, 20), on(36, 20)])
    // −50 − 10·log10(10^−6.0 + 10^−9.097) = −50 − (−59.9965)
    expect(sinr[0]).toBeCloseTo(10.0, 2)
    expect(sinr[1]).toBeCloseTo(10.0, 2)
    // −90 − 10·log10(10^−9.5 + 10^−9.097) = −90 − (−89.5229)
    expect(sinr[2]).toBeCloseTo(-0.48, 2)
  })

  it('makes a wider channel pay more noise', () => {
    const narrow = sinrDb(row(), [on(36, 20), on(149, 20)])
    const wide = sinrDb(row(), [on(42, 80), on(155, 80)])
    expect(narrow[0]! - wide[0]!).toBeCloseTo(6.02, 2)
  })

  it('makes a wider channel overlap a neighbour it would miss', () => {
    // At 20 MHz channels 36 and 44 are apart; at 80 MHz both sit in 42.
    const apart = sinrDb(row(), [on(36, 20), on(44, 20)])
    const together = sinrDb(row(), [on(42, 80), on(42, 80)])
    // −50 − 10·log10(10^−6.0 + 10^−8.495) = −50 − (−59.9861)
    expect(apart[0]).toBeCloseTo(40.97, 2)
    expect(together[0]).toBeCloseTo(9.99, 2)
  })

  it('treats Auto radios as on channels of their own', () => {
    const tunings = [on(undefined, 20), on(36, 20)]
    expect(sinrDb(row(), tunings)[0]).toBeCloseTo(40.97, 2)
    expect(autoChannelCount(tunings)).toBe(1)
  })

  it('leaves cells no access point reaches at −Infinity', () => {
    const coverage = row()
    coverage.strongest[2] = -1
    coverage.dbm[2] = Number.NEGATIVE_INFINITY
    expect(sinrDb(coverage, [on(36, 20), on(36, 20)])[2]).toBe(
      Number.NEGATIVE_INFINITY,
    )
  })

  it('counts access points on other floors', () => {
    const house = twoStoreyHouse()
    const plan: Plan = {
      ...house,
      accessPoints: house.accessPoints.map((ap) => ({
        ...ap,
        radios: ap.radios.map((r) => ({
          ...r,
          channel: 36,
          channelWidthMHz: 20 as const,
        })),
      })),
    }
    const floorId = plan.floors[0]!.id
    const coverage = evaluateCoverage(plan, floorId, '5GHz')
    const shared = sinrDb(coverage, sourceTunings(coverage, plan))
    const alone = sinrDb(
      coverage,
      sourceTunings(coverage, house).map((t) => ({
        ...t,
        channel: undefined,
      })),
    )
    expect(coverage.accessPointIds.length).toBeGreaterThan(1)
    let lower = 0
    shared.forEach((v, i) => {
      expect(v).toBeLessThanOrEqual(alone[i]! + 1e-4)
      if (v < alone[i]! - 1) lower++
    })
    expect(lower).toBeGreaterThan(0)
  })
})
