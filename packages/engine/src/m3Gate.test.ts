import type { Band } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES } from './bands.ts'
import { evaluateCoverage, RECEIVER_HEIGHT_M } from './coverage.ts'
import { summariseCoverage } from './floorArea.ts'
import { twoStoreyHome } from './testPlans.ts'

/**
 * M3 exit gate (D58): in the two-storey sample home, the router downstairs
 * gives sensible coverage on both floors.
 *
 * "Sensible" is checked against Recommendation ITU-R P.1238-13 (09/2025).
 * It has no single model for a house across floors at these frequencies:
 * eq. (1), the site-general model, is for both ends on one floor, and the
 * floor penetration factors of Table 5 belong to eq. (2), whose distance
 * coefficient N isn't given at 2.4 or 5 GHz (Table 4). So the reference
 * here combines them: eq. (1) with the office NLoS coefficients of Table 2
 * (the only indoor coefficients for walled rooms; there are none for homes),
 * plus the Table 5 residential "house" factor for one floor upstairs:
 *
 *   L = 10α·log10(d) + β + 10γ·log10(f) [+ Lf upstairs]
 *   α = 2.39, β = 30.13, γ = 2.40, σ = 5.01 dB (Table 2, office NLoS,
 *   4–30 m); Lf = 5 dB at 2.4 GHz and 7 dB at 5.2 GHz (Table 5, house).
 *
 * Each floor's median gap between this model's path loss and the reference,
 * over floor cells 4–30 m from the router (Table 2's distance range), must
 * be within 2σ (your choice), and the router must reach Fair on at least
 * 85% of each floor on 2.4 GHz.
 */
const ALPHA = 2.39
const BETA = 30.13
const GAMMA = 2.4
const SIGMA_DB = 5.01
/** Table 5 residential (house) factors, at the frequencies they're given. */
const HOUSE_FLOOR = { '2.4GHz': { f: 2.4, lf: 5 }, '5GHz': { f: 5.2, lf: 7 } }
const FAIR_DBM = -67

const reference = (d: number, f: number, lf: number) =>
  10 * ALPHA * Math.log10(d) + BETA + 10 * GAMMA * Math.log10(f) + lf

/** Median gap (model − reference path loss) over one floor, in dB. */
function medianGap(band: '2.4GHz' | '5GHz', floorId: string): number {
  const plan = twoStoreyHome()
  const router = plan.accessPoints[0]!
  const floor = plan.floors.find((f) => f.id === floorId)!
  const coverage = evaluateCoverage(plan, floorId, band)
  const { grid } = coverage
  const eirp = BAND_PROFILES[band].defaultTxPowerDbm
  const { f, lf } = HOUSE_FLOOR[band]
  const upstairs = floor.elevationM > 0
  const receiverZ = floor.elevationM + RECEIVER_HEIGHT_M
  const gaps: number[] = []
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const i = row * grid.cols + col
      if (!coverage.floorArea[i]) continue
      const x = grid.originX + (col + 0.5) * grid.cellM
      const y = grid.originY + (row + 0.5) * grid.cellM
      const d = Math.hypot(
        x - router.x,
        y - router.y,
        receiverZ - router.heightM,
      )
      if (d < 4 || d > 30) continue
      const modelLoss = eirp - coverage.dbm[i]!
      gaps.push(modelLoss - reference(d, f, upstairs ? lf : 0))
    }
  }
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

describe('M3 exit gate: one router in a two-storey home (D58)', () => {
  it('has a router downstairs and floor area on both floors', () => {
    const plan = twoStoreyHome()
    expect(plan.accessPoints.map((ap) => ap.floorId)).toEqual(['main'])
    const areas = plan.floors.map((f) =>
      Math.round(
        summariseCoverage(evaluateCoverage(plan, f.id, '2.4GHz'), FAIR_DBM)
          .areaM2,
      ),
    )
    // Upstairs loses the 3 m² stairwell.
    expect(areas).toEqual([150, 147])
  })

  it('reaches Fair on at least 85% of each floor on 2.4 GHz', () => {
    const plan = twoStoreyHome()
    for (const floor of plan.floors) {
      const { share } = summariseCoverage(
        evaluateCoverage(plan, floor.id, '2.4GHz'),
        FAIR_DBM,
      )
      expect(share, floor.name).toBeGreaterThanOrEqual(0.85)
    }
  })

  for (const band of ['2.4GHz', '5GHz'] as const satisfies Band[]) {
    it(`stays within 2σ of ITU-R P.1238-13 on both floors on ${band}`, () => {
      for (const floorId of ['main', 'up']) {
        const gap = medianGap(band, floorId)
        expect(Math.abs(gap), `${floorId}: ${gap.toFixed(1)} dB`).toBeLessThan(
          2 * SIGMA_DB,
        )
      }
    })
  }

  it('records how far off it is (see MODEL.md)', () => {
    // Upstairs the model is more optimistic than the reference, mostly
    // because the timber joist floor loses less than P.1238's house factor
    // (D50): kept here so a change shows up in review.
    const gaps = (['2.4GHz', '5GHz'] as const).flatMap((band) =>
      ['main', 'up'].map((floorId) =>
        Number(medianGap(band, floorId).toFixed(1)),
      ),
    )
    expect(gaps).toMatchInlineSnapshot(`
      [
        0.7,
        -2.3,
        -0.8,
        -5.5,
      ]
    `)
  })
})
