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

  it('keeps default power within the FCC limits', () => {
    // 1 W + 6 dBi at 2.4 and 5 GHz; 30 dBm for indoor 6 GHz (47 CFR 15).
    expect(BAND_PROFILES['2.4GHz'].maxEirpDbm).toBe(36)
    expect(BAND_PROFILES['5GHz'].maxEirpDbm).toBe(36)
    expect(BAND_PROFILES['6GHz'].maxEirpDbm).toBe(30)
    for (const profile of Object.values(BAND_PROFILES)) {
      expect(profile.defaultTxPowerDbm).toBeLessThanOrEqual(profile.maxEirpDbm)
    }
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

/**
 * Model against transmission measured at NIST from 3 to 8 GHz: W. C. Stone,
 * "Electromagnetic Signal Attenuation in Construction Materials", NISTIR 6055
 * (1997). The report gives each high-range curve as a polynomial in f (GHz),
 * received signal in dB relative to free space = M0 + M1·f + … + M6·f⁶
 * (Tables 4.13d, 4.14d and 4.15d); coefficients are copied as printed. Model
 * thicknesses are the measured ones (Tables 3.5.3, 3.6.2 and 3.8.2). Brick and
 * concrete disagree by 10–30 dB and are left out; see MODEL.md.
 */
describe('validation against NIST measurements at 5 and 6 GHz', () => {
  const specimens: {
    name: string
    layers: Layer[]
    /** M0…M6 of the dB curve. */
    fit: number[]
    /** The curve at 5 GHz as read from the report's plot, for transcription. */
    plotAt5GHz: number
  }[] = [
    {
      name: 'drywall, 6.94 mm (D25H)',
      layers: [{ material: 'plasterboard', thicknessM: mm(6.94) }],
      fit: [-3.661, 2.4242, -0.79028, 0.16723, -0.021237, 1.3407e-3, -3.121e-5],
      plotAt5GHz: 0,
    },
    {
      name: 'drywall, 12.52 mm (D50H)',
      layers: [{ material: 'plasterboard', thicknessM: mm(12.52) }],
      fit: [
        -1.3024, 0.56703, 0.047116, -0.046679, 8.2634e-3, -7.1352e-4, 2.5864e-5,
      ],
      plotAt5GHz: 0.2,
    },
    {
      name: 'glass, 5.68 mm (G25H)',
      layers: [{ material: 'glass', thicknessM: mm(5.68) }],
      fit: [-14.824, 12.201, -5.164, 1.2814, -0.18346, 0.013703, -4.0969e-4],
      plotAt5GHz: -1,
    },
    {
      name: 'glass, 12.52 mm (G50H)',
      layers: [{ material: 'glass', thicknessM: mm(12.52) }],
      fit: [-12.19, 11.883, -5.4546, 1.433, -0.21186, 0.015879, -4.6484e-4],
      plotAt5GHz: -0.1,
    },
    {
      name: 'glass, 18.60 mm (G75H)',
      layers: [{ material: 'glass', thicknessM: mm(18.6) }],
      fit: [-17.088, 14.896, -6.2841, 1.5197, -0.20985, 0.015169, -4.4443e-4],
      plotAt5GHz: -0.45,
    },
    {
      name: 'dry spruce-pine-fir, 36.95 mm (L15DH)',
      layers: [{ material: 'wood', thicknessM: mm(36.95) }],
      fit: [-16.547, 12.399, -5.4636, 1.4022, -0.20711, 0.015876, -4.8509e-4],
      plotAt5GHz: -3.3,
    },
    {
      name: 'dry spruce-pine-fir, 75.42 mm (L30DH)',
      layers: [{ material: 'wood', thicknessM: mm(75.42) }],
      fit: [-20.122, 11.806, -5.2732, 1.3594, -0.19937, 0.015069, -4.5414e-4],
      plotAt5GHz: -7.6,
    },
  ]

  const curveDb = (fit: number[], f: number) =>
    fit.reduce((sum, m, i) => sum + m * f ** i, 0)
  /** Measured loss averaged over the band as power, like `slabLossDb`. */
  const measuredLossDb = (fit: number[], frequencies: number[]) => {
    const power = frequencies.map((f) => 10 ** (curveDb(fit, f) / 10))
    return -10 * Math.log10(power.reduce((a, b) => a + b) / power.length)
  }

  it.each(specimens)('copies the curve for $name', ({ fit, plotAt5GHz }) => {
    expect(Math.abs(curveDb(fit, 5) - plotAt5GHz)).toBeLessThan(0.2)
  })

  it('averages a flat curve to its own value', () => {
    expect(measuredLossDb([-3, 0, 0, 0, 0, 0, 0], [5, 6])).toBeCloseTo(3, 10)
  })

  for (const band of ['5GHz', '6GHz'] as const) {
    const frequencies = bandSamples(BAND_PROFILES[band])
    it.each(specimens)(`is within 5 dB at ${band} for $name`, (specimen) => {
      const model = slabLossDb(specimen.layers, frequencies)
      const measured = measuredLossDb(specimen.fit, frequencies)
      expect(Math.abs(model - measured)).toBeLessThan(5)
    })
  }
})
