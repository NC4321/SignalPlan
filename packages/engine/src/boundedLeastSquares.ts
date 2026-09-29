/**
 * Bounded least squares: the x that minimises |A·x − b|² with every x_j
 * between lower_j and upper_j (D75).
 *
 * A primal active-set method on the normal equations, which suits the few
 * unknowns of a calibration fit. It starts from `start` (clamped into the
 * bounds) with every unknown free. Each step solves for the free unknowns
 * with the rest held at their bounds; if that leaves the box, it moves
 * towards the solution until the first unknown reaches its bound and holds
 * that one there. Once the free solution is inside the box, an unknown held
 * at a bound whose gradient points into the box is freed again. It stops
 * when none does: then x meets the optimality (KKT) conditions, and since
 * the problem is convex, it's the minimum.
 *
 * `rows` are the rows of A. Unknowns with no weight at all in A stay at
 * their start.
 */
export function boundedLeastSquares(
  rows: readonly (readonly number[])[],
  b: readonly number[],
  lower: readonly number[],
  upper: readonly number[],
  start: readonly number[],
): number[] {
  const k = lower.length
  // Normal equations: G = AᵀA, h = Aᵀb.
  const G = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const h = new Array<number>(k).fill(0)
  rows.forEach((row, r) => {
    for (let i = 0; i < k; i++) {
      const ai = row[i]!
      if (ai === 0) continue
      h[i]! += ai * b[r]!
      for (let j = 0; j < k; j++) G[i]![j]! += ai * row[j]!
    }
  })

  const x = start.map((v, j) => Math.min(Math.max(v, lower[j]!), upper[j]!))
  // Unknowns A doesn't touch are left where they start.
  const held = G.map((row, j) => row[j]! === 0)
  const scale = Math.max(...G.map((row, j) => row[j]!), 1)
  const tolerance = 1e-10 * scale

  for (let iteration = 0; iteration < 50 * (k + 1); iteration++) {
    const free = x.flatMap((_, j) => (held[j] ? [] : [j]))
    const z = solveFree(G, h, x, free)
    let alpha = 1
    let blocking = -1
    free.forEach((j, n) => {
      const target = z[n]!
      if (target < lower[j]!) {
        const a = (lower[j]! - x[j]!) / (target - x[j]!)
        if (a < alpha) [alpha, blocking] = [a, j]
      } else if (target > upper[j]!) {
        const a = (upper[j]! - x[j]!) / (target - x[j]!)
        if (a < alpha) [alpha, blocking] = [a, j]
      }
    })
    free.forEach((j, n) => {
      x[j] = x[j]! + Math.max(alpha, 0) * (z[n]! - x[j]!)
    })
    if (blocking >= 0) {
      x[blocking] =
        z[free.indexOf(blocking)]! < lower[blocking]!
          ? lower[blocking]!
          : upper[blocking]!
      held[blocking] = true
      continue
    }
    // The free unknowns are at their best. Free the held one whose gradient
    // most wants to move it into the box, if any does.
    let release = -1
    let worst = tolerance
    for (let j = 0; j < k; j++) {
      if (!held[j] || G[j]![j]! === 0) continue
      let gradient = -h[j]!
      for (let i = 0; i < k; i++) gradient += G[j]![i]! * x[i]!
      const pull =
        x[j]! <= lower[j]! ? -gradient : x[j]! >= upper[j]! ? gradient : 0
      if (pull > worst) [worst, release] = [pull, j]
    }
    if (release < 0) break
    held[release] = false
  }
  return x
}

/**
 * The free unknowns' least squares values with the others fixed at x:
 * G_FF·z = h_F − G_FH·x_H, by Cholesky. A tiny ridge keeps it solvable when
 * two unknowns always appear together.
 */
function solveFree(
  G: readonly (readonly number[])[],
  h: readonly number[],
  x: readonly number[],
  free: readonly number[],
): number[] {
  const n = free.length
  const isFree = new Set(free)
  const rhs = free.map((i) => {
    let value = h[i]!
    G[i]!.forEach((g, j) => {
      if (!isFree.has(j)) value -= g * x[j]!
    })
    return value
  })
  const M = free.map((i) =>
    free.map((j) => G[i]![j]! + (i === j ? 1e-12 * G[i]![i]! : 0)),
  )
  // M = L·Lᵀ.
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i]![j]!
      for (let p = 0; p < j; p++) sum -= L[i]![p]! * L[j]![p]!
      if (i === j) {
        L[i]![i] = Math.sqrt(Math.max(sum, 1e-300))
      } else {
        L[i]![j] = sum / L[j]![j]!
      }
    }
  }
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let sum = rhs[i]!
    for (let p = 0; p < i; p++) sum -= L[i]![p]! * y[p]!
    y[i] = sum / L[i]![i]!
  }
  const z = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!
    for (let p = i + 1; p < n; p++) sum -= L[p]![i]! * z[p]!
    z[i] = sum / L[i]![i]!
  }
  return z
}
