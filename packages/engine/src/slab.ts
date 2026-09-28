import {
  abs2,
  add,
  complex,
  div,
  exp,
  mul,
  mulNegJ,
  scale,
  sqrt,
  sub,
  type Complex,
} from './complex.ts'
import { SPEED_OF_LIGHT } from './pathLoss.ts'

/**
 * Electrical properties of building materials from Recommendation ITU-R
 * P.2040-4 (09/2025), Table 3, rows for the 1–100 GHz range (brick: 1–40 GHz).
 *
 *   ε′ = a·f^b      (eq. 57)
 *   σ  = c·f^d  S/m (eq. 58), f in GHz
 */
export const P2040_MATERIALS = {
  air: { a: 1, b: 0, c: 0, d: 0 },
  concrete: { a: 5.24, b: 0, c: 0.0462, d: 0.7822 },
  brick: { a: 3.91, b: 0, c: 0.0238, d: 0.16 },
  plasterboard: { a: 2.73, b: 0, c: 0.0085, d: 0.9395 },
  wood: { a: 1.99, b: 0, c: 0.0047, d: 1.0718 },
  glass: { a: 6.31, b: 0, c: 0.0036, d: 1.3394 },
  chipboard: { a: 2.58, b: 0, c: 0.0217, d: 0.78 },
  metal: { a: 1, b: 0, c: 1e7, d: 0 },
} as const

export type P2040Material = keyof typeof P2040_MATERIALS

/**
 * Materials whose properties are fitted to measurements instead of taken from
 * P.2040, in the same form (eqs. 57–58).
 *
 * `brick-fitted` keeps P.2040's ε′ = 3.91 but has σ = 0.0170·f^0.92 S/m, fitted
 * so an 87.1 mm slab reproduces the brick wall measured head on by A. H.
 * Muqaibel, "Characterization of Ultra Wideband Communication Channels", PhD
 * dissertation, Virginia Tech, 2003, Table 4.3: 1.0702·f + 0.9757 dB, averaged
 * over each band. P.2040's brick (σ = 0.0238·f^0.16) under-predicts that wall
 * by 1–5 dB, and NIST's brick at 2.0 GHz (NISTIR 6055) points the same way.
 */
export const FITTED_MATERIALS = {
  'brick-fitted': { a: 3.91, b: 0, c: 0.017, d: 0.92 },
} as const

export type FittedMaterial = keyof typeof FITTED_MATERIALS

const MATERIAL_PROPERTIES = { ...P2040_MATERIALS, ...FITTED_MATERIALS }

/** One layer of a wall: a P.2040 or fitted material, or a conductive film. */
export type Layer =
  | { material: P2040Material | FittedMaterial; thicknessM: number }
  | {
      /** A thin conductive film, such as a low-E coating, by sheet resistance. */
      sheetResistanceOhms: number
      thicknessM: number
    }

/**
 * Complex relative permittivity ε′ − jε″ of a layer at a frequency, with
 * ε″ = 17.98·σ / f (P.2040 eq. 59, f in GHz).
 */
export function permittivity(layer: Layer, frequencyGHz: number): Complex {
  if ('sheetResistanceOhms' in layer) {
    const sigma = 1 / (layer.sheetResistanceOhms * layer.thicknessM)
    return complex(1, (-17.98 * sigma) / frequencyGHz)
  }
  const { a, b, c, d } = MATERIAL_PROPERTIES[layer.material]
  const realPart = a * frequencyGHz ** b
  const sigma = c * frequencyGHz ** d
  return complex(realPart, (-17.98 * sigma) / frequencyGHz)
}

export type Polarisation = 'TE' | 'TM'

/**
 * Power transmission coefficient |T|² of a multi-layer slab in air, by the
 * general method of P.2040-4 § 2.2.2.1 (eqs. 39–42).
 *
 * @param angleRad Angle of incidence from the wall's normal.
 */
export function slabTransmission(
  layers: readonly Layer[],
  frequencyGHz: number,
  angleRad: number,
  polarisation: Polarisation,
): number {
  const k0 = (2 * Math.PI * frequencyGHz * 1e9) / SPEED_OF_LIGHT
  const sin2 = Math.sin(angleRad) ** 2

  // Layers 0 and N+1 are the surrounding air, with zero width.
  const eps = [
    complex(1),
    ...layers.map((layer) => permittivity(layer, frequencyGHz)),
    complex(1),
  ]
  const width = [0, ...layers.map((layer) => layer.thicknessM), 0]
  // η_n = √ε_n·cos θ_n = √(ε_n − sin²θ₀), so γ_n = k₀·η_n (eq. 41a).
  const eta = eps.map((e) => sqrt(sub(e, complex(sin2))))
  const last = layers.length + 1

  // Fresnel coefficient at the interface between layers n and n+1 (eq. 40).
  const fresnel = (n: number): Complex => {
    if (polarisation === 'TE') {
      return div(sub(eta[n]!, eta[n + 1]!), add(eta[n]!, eta[n + 1]!))
    }
    // eq. 40b multiplied through by √ε_n·√ε_n+1.
    const p = mul(eps[n + 1]!, eta[n]!)
    const q = mul(eps[n]!, eta[n + 1]!)
    return div(sub(p, q), add(p, q))
  }
  // e^(−jγd), the one-way phase and attenuation through layer n.
  const propagate = (n: number, times: number): Complex =>
    exp(mulNegJ(scale(eta[n]!, k0 * width[n]! * times)))

  // Reflection coefficients from the far side back (eq. 39), R(N+1) = 0.
  const reflection: Complex[] = new Array<Complex>(last + 1)
  reflection[last] = complex(0)
  const denominators: Complex[] = new Array<Complex>(last)
  for (let n = last - 1; n >= 0; n--) {
    const r = fresnel(n)
    const tail = mul(reflection[n + 1]!, propagate(n + 1, 2))
    denominators[n] = add(complex(1), mul(r, tail))
    reflection[n] = div(add(r, tail), denominators[n]!)
  }

  // Transmission coefficient (eq. 42b).
  let transmission = complex(1)
  for (let n = 0; n < last; n++) {
    const term = div(
      mul(propagate(n, 1), add(complex(1), fresnel(n))),
      denominators[n]!,
    )
    transmission = mul(transmission, term)
  }
  return abs2(transmission)
}

/**
 * Loss in dB through a slab for a wave of random polarisation: the mean of
 * the TE and TM power transmission, averaged over the given frequencies.
 */
export function slabLossDb(
  layers: readonly Layer[],
  frequenciesGHz: readonly number[],
  angleRad = 0,
): number {
  let sum = 0
  for (const f of frequenciesGHz) {
    sum += slabTransmission(layers, f, angleRad, 'TE')
    sum += slabTransmission(layers, f, angleRad, 'TM')
  }
  const mean = sum / (2 * frequenciesGHz.length)
  return mean > 0 ? -10 * Math.log10(mean) : Number.POSITIVE_INFINITY
}
