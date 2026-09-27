import { WALL_MATERIALS } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES, bandSamples } from './bands.ts'
import { CONSTRUCTIONS, MATERIAL_LOSS_DB } from './materials.ts'
import { slabLossDb, type Layer } from './slab.ts'

const mm = (t: number) => t / 1000

describe('band profiles', () => {
  it('uses the free-space loss at 1 m for the band midpoint', () => {
    expect(BAND_PROFILES['2.4GHz'].referenceLossDb).toBeCloseTo(40.18, 2)
    expect(BAND_PROFILES['5GHz'].referenceLossDb).toBeCloseTo(47.29, 2)
    expect(BAND_PROFILES['6GHz'].referenceLossDb).toBeCloseTo(48.74, 2)
  })

  it('samples a band from edge to edge', () => {
    const samples = bandSamples(BAND_PROFILES['6GHz'], 5)
    expect(samples).toHaveLength(5)
    expect(samples[0]).toBe(5.925)
    expect(samples[4]).toBeCloseTo(7.125, 12)
  })
})

describe('material losses', () => {
  it('has a construction for every wall material', () => {
    expect(Object.keys(CONSTRUCTIONS).sort()).toEqual(
      [...WALL_MATERIALS].sort(),
    )
  })

  // Pinned so docs/MODEL.md stays in step with the code. Update both together.
  it.each([
    [
      '2.4GHz',
      {
        drywall: 2.9,
        brick: 5.8,
        concrete: 14.7,
        glass: 0.5,
        'low-e-glass': 23.5,
        wood: 0.7,
        metal: 40,
      },
    ],
    [
      '5GHz',
      {
        drywall: 2.4,
        brick: 5.3,
        concrete: 26.5,
        glass: 6.1,
        'low-e-glass': 29.9,
        wood: 1.8,
        metal: 40,
      },
    ],
    [
      '6GHz',
      {
        drywall: 1.4,
        brick: 5.2,
        concrete: 29.9,
        glass: 8.3,
        'low-e-glass': 29.8,
        wood: 2.1,
        metal: 40,
      },
    ],
  ] as const)('match the table in MODEL.md at %s', (band, expected) => {
    for (const [material, loss] of Object.entries(expected)) {
      expect(
        MATERIAL_LOSS_DB[band][material as keyof typeof expected],
      ).toBeCloseTo(loss, 1)
    }
  })

  it('caps metal at 40 dB', () => {
    expect(MATERIAL_LOSS_DB['5GHz'].metal).toBe(40)
  })
})

/**
 * Model against measured penetration loss at 6.75 GHz (co-polarised), from
 * Shakya et al., IEEE GLOBECOM 2024, Table II, using each sample's thickness.
 * The model is not tuned to these except for the low-E coating, so this guards
 * against drift rather than proving accuracy; differences are in MODEL.md.
 */
describe('validation against NYU measurements at 6.75 GHz', () => {
  const at675 = (layers: Layer[]) => slabLossDb(layers, [6.75])

  it('reproduces the low-E window it was fitted to', () => {
    expect(at675(CONSTRUCTIONS['low-e-glass'].layers)).toBeCloseTo(29.7, 1)
  })

  it.each([
    ['wooden door, 45 mm', [{ material: 'wood', thicknessM: mm(45) }], 5.8],
    ['clear glass, 10 mm', [{ material: 'glass', thicknessM: mm(10) }], 3.6],
    [
      'drywall panel, 30 mm',
      [{ material: 'plasterboard', thicknessM: mm(30) }],
      0.6,
    ],
    [
      'plasterboard wall, 137 mm',
      [
        { material: 'plasterboard', thicknessM: mm(12.7) },
        { material: 'air', thicknessM: mm(111.6) },
        { material: 'plasterboard', thicknessM: mm(12.7) },
      ],
      2.1,
    ],
  ] as [string, Layer[], number][])(
    'is within 4 dB for %s',
    (_, layers, measured) => {
      expect(Math.abs(at675(layers) - measured)).toBeLessThan(4)
    },
  )
})
