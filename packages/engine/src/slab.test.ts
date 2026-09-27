import { describe, expect, it } from 'vitest'
import {
  abs2,
  complex,
  div,
  exp,
  mul,
  mulNegJ,
  scale,
  sqrt,
  sub,
} from './complex.ts'
import { SPEED_OF_LIGHT } from './pathLoss.ts'
import {
  P2040_MATERIALS,
  permittivity,
  slabLossDb,
  slabTransmission,
  type Layer,
  type Polarisation,
} from './slab.ts'

const mm = (t: number) => t / 1000

/**
 * Independent implementation of the single-layer slab, P.2040-4 eqs. 43b and
 * 44, to cross-check the general multi-layer method.
 */
function singleSlab(
  layer: Layer,
  frequencyGHz: number,
  angleRad: number,
  polarisation: Polarisation,
): number {
  const eps = permittivity(layer, frequencyGHz)
  const sin2 = Math.sin(angleRad) ** 2
  const cos = complex(Math.cos(angleRad))
  const root = sqrt(sub(eps, complex(sin2)))
  // Air-to-material Fresnel reflection coefficient.
  const reflection =
    polarisation === 'TE'
      ? div(sub(cos, root), { re: cos.re + root.re, im: root.im })
      : div(sub(mul(eps, cos), root), {
          re: mul(eps, cos).re + root.re,
          im: mul(eps, cos).im + root.im,
        })
  const lambda = SPEED_OF_LIGHT / (frequencyGHz * 1e9)
  const q = scale(root, (2 * Math.PI * layer.thicknessM) / lambda)
  const r2 = mul(reflection, reflection)
  const numerator = mul(sub(complex(1), r2), exp(mulNegJ(q)))
  const denominator = sub(complex(1), mul(r2, exp(mulNegJ(scale(q, 2)))))
  return abs2(div(numerator, denominator))
}

describe('permittivity', () => {
  it('follows P.2040 eqs. 57–59 for concrete at 1 GHz', () => {
    const eps = permittivity({ material: 'concrete', thicknessM: 0.1 }, 1)
    expect(eps.re).toBe(5.24)
    expect(eps.im).toBeCloseTo(-17.98 * 0.0462, 12)
  })
})

describe('slabTransmission', () => {
  it('passes everything through air', () => {
    const air: Layer[] = [{ material: 'air', thicknessM: 0.1 }]
    expect(slabTransmission(air, 5, 0, 'TE')).toBeCloseTo(1, 12)
    expect(slabTransmission(air, 5, 0.7, 'TM')).toBeCloseTo(1, 12)
  })

  it.each([
    ['TE', 0],
    ['TE', Math.PI / 6],
    ['TM', Math.PI / 6],
    ['TM', Math.PI / 3],
  ] as const)(
    'matches the single-slab formula for %s at %f rad',
    (polarisation, angle) => {
      const layer: Layer = { material: 'concrete', thicknessM: mm(100) }
      expect(slabTransmission([layer], 2.4, angle, polarisation)).toBeCloseTo(
        singleSlab(layer, 2.4, angle, polarisation),
        12,
      )
    },
  )

  it('is transparent at half-wave thickness and most reflective at quarter-wave', () => {
    // At 5 GHz in glass (ε′ = 6.31) the wavelength is 60 mm / √6.31.
    const inside = 299.792458 / 5 / Math.sqrt(P2040_MATERIALS.glass.a)
    const halfWave = slabLossDb(
      [{ material: 'glass', thicknessM: mm(inside / 2) }],
      [5],
    )
    const quarterWave = slabLossDb(
      [{ material: 'glass', thicknessM: mm(inside / 4) }],
      [5],
    )
    // A half-wave slab reflects nothing, so only absorption (eq. 27a) remains.
    const { a, c, d } = P2040_MATERIALS.glass
    const absorption = ((1636 * c * 5 ** d) / Math.sqrt(a)) * mm(inside / 2)
    expect(Math.abs(halfWave - absorption)).toBeLessThan(0.15)
    // Lossless quarter-wave slab: |T|² = ((1 − ρ²)/(1 + ρ²))², ρ = (√ε − 1)/(√ε + 1).
    const rho = (Math.sqrt(6.31) - 1) / (Math.sqrt(6.31) + 1)
    const ideal = -10 * Math.log10(((1 - rho ** 2) / (1 + rho ** 2)) ** 2)
    expect(quarterWave).toBeCloseTo(ideal, 0)
  })

  it('attenuates thick lossy slabs at the P.2040 eq. 27a rate', () => {
    const f = 5.5
    const { a, c, d } = P2040_MATERIALS.concrete
    const rate = (1636 * c * f ** d) / Math.sqrt(a) // dB per metre
    const loss = (t: number) =>
      slabLossDb([{ material: 'concrete', thicknessM: t }], [f])
    expect((loss(0.4) - loss(0.3)) / 0.1).toBeCloseTo(rate, -1)
  })

  it('never gains power', () => {
    for (const material of Object.keys(
      P2040_MATERIALS,
    ) as (keyof typeof P2040_MATERIALS)[]) {
      for (const f of [2.4, 5.5, 6.5]) {
        const t = slabTransmission(
          [{ material, thicknessM: mm(20) }],
          f,
          0.4,
          'TM',
        )
        expect(t).toBeLessThanOrEqual(1 + 1e-12)
        expect(t).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('makes metal an effectively total blocker', () => {
    expect(
      slabLossDb([{ material: 'metal', thicknessM: mm(1) }], [2.4]),
    ).toBeGreaterThan(1000)
  })
})
