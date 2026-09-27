/** Minimal immutable complex arithmetic for the slab transmission model. */
export interface Complex {
  re: number
  im: number
}

export const complex = (re: number, im = 0): Complex => ({ re, im })

export const add = (a: Complex, b: Complex): Complex =>
  complex(a.re + b.re, a.im + b.im)

export const sub = (a: Complex, b: Complex): Complex =>
  complex(a.re - b.re, a.im - b.im)

export const mul = (a: Complex, b: Complex): Complex =>
  complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)

export const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im
  return complex(
    (a.re * b.re + a.im * b.im) / d,
    (a.im * b.re - a.re * b.im) / d,
  )
}

export const scale = (a: Complex, k: number): Complex =>
  complex(a.re * k, a.im * k)

export const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im

/** Principal square root. */
export const sqrt = (a: Complex): Complex => {
  const r = Math.hypot(a.re, a.im)
  const re = Math.sqrt((r + a.re) / 2)
  const im = Math.sqrt((r - a.re) / 2)
  return complex(re, a.im < 0 ? -im : im)
}

/** e^z */
export const exp = (a: Complex): Complex => {
  const m = Math.exp(a.re)
  return complex(m * Math.cos(a.im), m * Math.sin(a.im))
}

/** −j·z, a quarter turn clockwise. */
export const mulNegJ = (a: Complex): Complex => complex(a.im, -a.re)
