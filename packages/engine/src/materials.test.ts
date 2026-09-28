import { FLOOR_MATERIALS, WALL_MATERIALS } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES, bandSamples } from './bands.ts'
import {
  constructionLossDb,
  CONSTRUCTIONS,
  FLOOR_CONSTRUCTIONS,
  FLOOR_LOSS_DB,
  FLOOR_ANGLE_CAP_DEG,
  floorConstructionLossDb,
  floorLossAtDb,
  floorLossTable,
  MATERIAL_LOSS_DB,
} from './materials.ts'
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
        brick: 6.6,
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
        brick: 9.0,
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
        brick: 9.9,
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

/**
 * Model against NIST's low-range measurements at 2.0 GHz, the top of their
 * 0.5–2.0 GHz range and the closest lab data to the 2.4 GHz band: NISTIR 6055,
 * Tables 4.13b, 4.14b and 4.15b, in the same polynomial form as above. The
 * printed drywall table gives nearly the same curve in all three columns, and
 * only D50L matches its plot, so the others are left out. Thicknesses are the
 * measured ones (Tables 3.5.3, 3.6.2 and 3.8.2). Brick and concrete are in
 * MODEL.md.
 */
describe('validation against NIST measurements at 2.0 GHz', () => {
  const specimens: {
    name: string
    layers: Layer[]
    /** M0…M6 of the dB curve. */
    fit: number[]
    /** The curve at 2.0 GHz as read from the report's plot, for transcription. */
    plotAt2GHz: number
  }[] = [
    {
      name: 'drywall, 12.52 mm (D50L)',
      layers: [{ material: 'plasterboard', thicknessM: mm(12.52) }],
      fit: [0.11164, -0.37506, -0.36647, 0.63649, -0.48783, 0.18759, -0.028084],
      plotAt2GHz: -0.63,
    },
    {
      name: 'glass, 5.68 mm (G25L)',
      layers: [{ material: 'glass', thicknessM: mm(5.68) }],
      fit: [1.1444, -4.1804, 4.6468, -3.8722, 1.8625, -0.41623, 0.026245],
      plotAt2GHz: -1.45,
    },
    {
      name: 'glass, 12.52 mm (G50L)',
      layers: [{ material: 'glass', thicknessM: mm(12.52) }],
      fit: [0.55734, -6.1539, 7.5398, -6.7859, 3.3498, -0.76848, 0.05514],
      plotAt2GHz: -3.3,
    },
    {
      name: 'glass, 18.60 mm (G75L)',
      layers: [{ material: 'glass', thicknessM: mm(18.6) }],
      fit: [-0.48576, -6.0418, 7.8315, -7.5311, 4.1246, -1.1108, 0.11126],
      plotAt2GHz: -3.9,
    },
    {
      name: 'dry spruce-pine-fir, 36.95 mm (L15DL)',
      layers: [{ material: 'wood', thicknessM: mm(36.95) }],
      fit: [-0.037815, -8.4443, 16.274, -20.175, 13.042, -4.0665, 0.4902],
      plotAt2GHz: -3.35,
    },
    {
      name: 'dry spruce-pine-fir, 75.42 mm (L30DL)',
      layers: [{ material: 'wood', thicknessM: mm(75.42) }],
      fit: [1.34, -12.841, 26.101, -30.397, 16.748, -4.1246, 0.34943],
      plotAt2GHz: -4.8,
    },
  ]

  const curveDb = (fit: number[], f: number) =>
    fit.reduce((sum, m, i) => sum + m * f ** i, 0)

  it.each(specimens)('copies the curve for $name', ({ fit, plotAt2GHz }) => {
    expect(Math.abs(curveDb(fit, 2) - plotAt2GHz)).toBeLessThan(0.2)
  })

  it.each(specimens)('is within 4 dB at 2.0 GHz for $name', (specimen) => {
    const model = slabLossDb(specimen.layers, [2])
    const measured = -curveDb(specimen.fit, 2)
    expect(Math.abs(model - measured)).toBeLessThan(4)
  })
})

/**
 * Model against insertion loss measured head on by A. H. Muqaibel,
 * "Characterization of Ultra Wideband Communication Channels", PhD
 * dissertation, Virginia Tech, 2003, Table 4.3. The table gives each sample's
 * loss as a straight line in frequency, a·f + b dB (f in GHz), and its loss at
 * 5 GHz; thicknesses are the table's. The brick wall is dry-stacked cored clay
 * brick (Figure B2.1). P.2040's brick under-predicts it, so the model's brick
 * conductivity is fitted to it (`brick-fitted` in slab.ts, D36).
 */
describe('validation against Muqaibel measurements at 2.4, 5 and 6 GHz', () => {
  const specimens = {
    door: {
      name: 'wooden door, 44.5 mm',
      layers: [{ material: 'wood', thicknessM: mm(44.4754) }] as Layer[],
      line: [0.3777, 0.1258],
      tableAt5GHz: 2.0,
    },
    glass: {
      name: 'glass, 2.36 mm',
      layers: [{ material: 'glass', thicknessM: mm(2.35661) }] as Layer[],
      line: [0.2895, 0.1005],
      tableAt5GHz: 1.25,
    },
    brick: {
      name: 'brick wall, 87.1 mm',
      layers: [
        { material: 'brick-fitted', thicknessM: mm(87.1474) },
      ] as Layer[],
      line: [1.0702, 0.9757],
      tableAt5GHz: 6.45,
    },
  }

  const lineDb = ([a, b]: number[], f: number) => a! * f + b!
  /** Measured loss averaged over the band as power, like `slabLossDb`. */
  const measuredLossDb = (line: number[], frequencies: number[]) => {
    const power = frequencies.map((f) => 10 ** (-lineDb(line, f) / 10))
    return -10 * Math.log10(power.reduce((a, b) => a + b) / power.length)
  }

  it.each(Object.values(specimens))(
    'copies the line for $name',
    ({ line, tableAt5GHz }) => {
      // The table's 5 GHz value is measured; the line is a fit to it.
      expect(Math.abs(lineDb(line, 5) - tableAt5GHz)).toBeLessThan(0.35)
    },
  )

  for (const band of ['2.4GHz', '5GHz', '6GHz'] as const) {
    const frequencies = bandSamples(BAND_PROFILES[band])
    it.each([specimens.door, specimens.glass])(
      `is within 1 dB at ${band} for $name`,
      ({ layers, line }) => {
        const model = slabLossDb(layers, frequencies)
        const measured = measuredLossDb(line, frequencies)
        expect(Math.abs(model - measured)).toBeLessThan(1)
      },
    )
  }

  // The line is stated for 1–7 GHz; the 6 GHz band runs to 7.125 GHz, so its
  // top 0.125 GHz is a short extrapolation.
  it.each(['2.4GHz', '5GHz', '6GHz'] as const)(
    'reproduces the brick wall it was fitted to within 0.3 dB at %s',
    (band) => {
      const frequencies = bandSamples(BAND_PROFILES[band])
      const { layers, line } = specimens.brick
      const measured = measuredLossDb(line, frequencies)
      expect(Math.abs(slabLossDb(layers, frequencies) - measured)).toBeLessThan(
        0.3,
      )
    },
  )

  it.each(['2.4GHz', '5GHz', '6GHz'] as const)(
    "shows why: P.2040's brick under-predicts it by 0.5–5 dB at %s",
    (band) => {
      const frequencies = bandSamples(BAND_PROFILES[band])
      const shortfall =
        measuredLossDb(specimens.brick.line, frequencies) -
        slabLossDb(
          [{ material: 'brick', thicknessM: mm(87.1474) }],
          frequencies,
        )
      expect(shortfall).toBeGreaterThan(0.5)
      expect(shortfall).toBeLessThan(5)
    },
  )

  it('averages a flat line to its own value', () => {
    expect(measuredLossDb([0, 3], [5, 6])).toBeCloseTo(3, 10)
  })
})

describe('floor losses (D50)', () => {
  it('has a construction for every floor material', () => {
    expect(Object.keys(FLOOR_CONSTRUCTIONS).sort()).toEqual(
      [...FLOOR_MATERIALS].sort(),
    )
  })

  // Pinned so docs/MODEL.md stays in step with the code. Update both together.
  it.each([
    ['2.4GHz', { 'timber-joist': 2.5, 'concrete-slab': 11.5 }],
    ['5GHz', { 'timber-joist': 2.7, 'concrete-slab': 20.2 }],
    ['6GHz', { 'timber-joist': 3.1, 'concrete-slab': 22.8 }],
  ] as const)('%s', (band, expected) => {
    for (const [material, loss] of Object.entries(expected)) {
      expect(
        FLOOR_LOSS_DB[band][material as keyof typeof expected],
      ).toBeCloseTo(loss, 1)
    }
  })

  it('averages power over the variants, not dB', () => {
    // A lossless variant (an air gap) and a lossy one: the loss of their
    // mean power, which is below the mean of their losses in dB (e.g. 0 and
    // 10 dB give 2.6 dB, not 5).
    const air = [{ material: 'air' as const, thicknessM: mm(10) }]
    const lossy = [{ material: 'concrete' as const, thicknessM: mm(10) }]
    const band = '5GHz'
    const samples = bandSamples(BAND_PROFILES[band])
    const a = slabLossDb(air, samples)
    const b = slabLossDb(lossy, samples)
    const expected = -10 * Math.log10((10 ** (-a / 10) + 10 ** (-b / 10)) / 2)
    expect(
      floorConstructionLossDb(
        { description: '', variants: [air, lossy] },
        band,
      ),
    ).toBeCloseTo(expected, 10)
    expect(a).toBeCloseTo(0, 10)
  })

  it('matches a wall with the same layers when there is one variant', () => {
    const layers = FLOOR_CONSTRUCTIONS['concrete-slab'].variants[0]!
    for (const band of ['2.4GHz', '5GHz', '6GHz'] as const) {
      expect(FLOOR_LOSS_DB[band]['concrete-slab']).toBeCloseTo(
        constructionLossDb({ description: '', layers }, band),
        10,
      )
    }
  })

  it('agrees with ITU-R P.1238-13 for a concrete floor head on', () => {
    // P.1238-13, text after Table 5: at 5.2 GHz and normal incidence, a
    // typical reinforced concrete floor with a suspended false ceiling adds
    // 20 dB (σ 1.5 dB). The model's 150 mm slab must be within 2σ.
    const [slab] = FLOOR_CONSTRUCTIONS['concrete-slab'].variants
    expect(Math.abs(slabLossDb(slab!, [5.2]) - 20)).toBeLessThan(3)
  })

  it('makes concrete lose far more than timber in every band', () => {
    for (const band of ['2.4GHz', '5GHz', '6GHz'] as const) {
      const { 'timber-joist': timber, 'concrete-slab': concrete } =
        FLOOR_LOSS_DB[band]
      expect(timber).toBeGreaterThan(0)
      expect(concrete).toBeGreaterThan(timber + 5)
    }
  })
})

describe('floor losses by angle (D60)', () => {
  const BANDS = ['2.4GHz', '5GHz', '6GHz'] as const
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  /** A path at `degrees` from the vertical, as (across, up). */
  const at = (degrees: number) =>
    [Math.sin(radians(degrees)), Math.cos(radians(degrees))] as const

  it('is the head-on loss straight up', () => {
    for (const band of BANDS) {
      for (const material of FLOOR_MATERIALS) {
        const table = floorLossTable(band, material)
        expect(table[0]).toBe(FLOOR_LOSS_DB[band][material])
        expect(floorLossAtDb(table, 0, 2.7)).toBe(FLOOR_LOSS_DB[band][material])
      }
    }
  })

  it('stays within 0.1 dB of the slab worked out at the angle itself', () => {
    // Worst on timber at 2.4 GHz, where the joist cavity's resonance moves
    // with the angle: about 0.06 dB with half-degree steps.
    for (const band of BANDS) {
      for (const material of FLOOR_MATERIALS) {
        const table = floorLossTable(band, material)
        const construction = FLOOR_CONSTRUCTIONS[material]
        for (let degrees = 0.3; degrees < FLOOR_ANGLE_CAP_DEG; degrees += 1.7) {
          const exact = floorConstructionLossDb(
            construction,
            band,
            radians(degrees),
          )
          expect(
            Math.abs(floorLossAtDb(table, ...at(degrees)) - exact),
          ).toBeLessThan(0.1)
        }
      }
    }
  })

  it('stops growing at the cap, even flat along the slab', () => {
    for (const band of BANDS) {
      for (const material of FLOOR_MATERIALS) {
        const table = floorLossTable(band, material)
        const capped = table[table.length - 1]!
        expect(floorLossAtDb(table, ...at(FLOOR_ANGLE_CAP_DEG))).toBeCloseTo(
          capped,
          10,
        )
        expect(floorLossAtDb(table, ...at(89))).toBe(capped)
        expect(floorLossAtDb(table, 5, 0)).toBe(capped)
      }
    }
  })

  it('loses more at the cap than head on, in every band', () => {
    for (const band of BANDS) {
      for (const material of FLOOR_MATERIALS) {
        const table = floorLossTable(band, material)
        expect(table[table.length - 1]!).toBeGreaterThan(table[0]! + 1)
      }
    }
  })

  // Pinned so docs/MODEL.md stays in step with the code. Update both together.
  it.each([
    ['2.4GHz', 60, { 'timber-joist': 3.4, 'concrete-slab': 12.4 }],
    ['2.4GHz', 75, { 'timber-joist': 5.4, 'concrete-slab': 13.6 }],
    ['5GHz', 60, { 'timber-joist': 4.2, 'concrete-slab': 22.0 }],
    ['5GHz', 75, { 'timber-joist': 6.6, 'concrete-slab': 23.4 }],
    ['6GHz', 60, { 'timber-joist': 4.0, 'concrete-slab': 24.7 }],
    ['6GHz', 75, { 'timber-joist': 6.4, 'concrete-slab': 26.2 }],
  ] as const)('%s at %i°', (band, degrees, expected) => {
    for (const [material, loss] of Object.entries(expected)) {
      const table = floorLossTable(band, material as keyof typeof expected)
      expect(floorLossAtDb(table, ...at(degrees))).toBeCloseTo(loss, 1)
    }
  })
})
