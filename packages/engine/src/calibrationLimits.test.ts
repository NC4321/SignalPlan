import { BANDS, FLOOR_MATERIALS, WALL_MATERIALS } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  DEVICE_OFFSET_LIMITS_DB,
  EXPONENT_LIMITS,
  floorLimitsDb,
  wallLimitsDb,
} from './calibrationLimits.ts'
import { FLOOR_LOSS_DB, MATERIAL_LOSS_DB } from './materials.ts'

const round = (limits: readonly [number, number] | undefined) =>
  limits?.map((v) => Math.round(v * 10) / 10)

describe('calibration limits (D75)', () => {
  it('match the table in docs/MODEL.md', () => {
    const walls = Object.fromEntries(
      WALL_MATERIALS.map((m) => [
        m,
        BANDS.map((band) => round(wallLimitsDb(band, m))),
      ]),
    )
    expect(walls).toEqual({
      drywall: [
        [0.6, 5.4],
        [0, 2.4],
        [0, 2.1],
      ],
      brick: [
        [3.6, 7.6],
        [6.9, 15.4],
        [7.9, 15.6],
      ],
      concrete: [
        [1.4, 34.9],
        [3.6, 57.2],
        [4.4, 62.4],
      ],
      glass: [
        [0.5, 6.4],
        [0.3, 6.1],
        [0.5, 8.3],
      ],
      'low-e-glass': [undefined, undefined, undefined],
      wood: [
        [0.7, 4.8],
        [1.8, 7.7],
        [2.1, 8.2],
      ],
      metal: [undefined, undefined, undefined],
    })
    const floors = Object.fromEntries(
      FLOOR_MATERIALS.map((m) => [
        m,
        BANDS.map((band) => round(floorLimitsDb(band, m))),
      ]),
    )
    expect(floors).toEqual({
      'timber-joist': [[2.5, 5], [2.7, 7], undefined],
      'concrete-slab': [[10, 11.5], [13, 23], undefined],
    })
    expect(EXPONENT_LIMITS).toEqual([1.47, 2.39])
    expect(DEVICE_OFFSET_LIMITS_DB).toEqual([-30, 30])
  })

  it('always contain the default', () => {
    for (const band of BANDS) {
      for (const m of WALL_MATERIALS) {
        const limits = wallLimitsDb(band, m)
        if (!limits) continue
        const loss = MATERIAL_LOSS_DB[band][m]
        expect(limits[0]).toBeLessThanOrEqual(loss)
        expect(limits[1]).toBeGreaterThanOrEqual(loss)
      }
      for (const m of FLOOR_MATERIALS) {
        const limits = floorLimitsDb(band, m)
        if (!limits) continue
        const loss = FLOOR_LOSS_DB[band][m]
        expect(limits[0]).toBeLessThanOrEqual(loss)
        expect(limits[1]).toBeGreaterThanOrEqual(loss)
      }
    }
    expect(EXPONENT_LIMITS[0]).toBeLessThan(2)
    expect(EXPONENT_LIMITS[1]).toBeGreaterThan(2)
  })
})
