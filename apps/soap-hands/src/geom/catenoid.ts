// The catenoid spanning two coaxial circles of radii R1, R2 a distance h apart: r(z) = a cosh((z − z0)/a)
// with r(0) = R1, r(h) = R2. Solutions exist only up to a maximum h (for R1 = R2, h/R ≈ 1.3255: the
// Goldschmidt limit, where the real film pops into two discs). Tested in tests/catenoid.test.ts.
//
// For fixed R1 ≤ R2 the solutions form one family, parametrised here by s ∈ [0, 2]:
//   s ∈ [0, 1]: neck outside the rings (beyond the smaller), a = m·s, h = a |acosh(R2/a) − acosh(R1/a)|
//   s ∈ [1, 2]: neck between the rings, a = m·(2 − s),            h = a (acosh(R1/a) + acosh(R2/a))
// with m = min(R1, R2). h(s) rises from 0 to its maximum; past it the solutions are unstable.

export interface Catenoid {
  exists: boolean
  R1: number
  R2: number
  h: number
  /** The largest h with a stable catenoid. */
  hMax: number
  a: number
  /** The neck's z (may lie outside [0, h]). */
  z0: number
}

function family(R1: number, R2: number, s: number): { a: number; h: number; z0: number } {
  const m = Math.min(R1, R2)
  const inside = s >= 1
  const a = m * Math.max(1e-9, inside ? 2 - s : s)
  const a1 = Math.acosh(Math.max(1, R1 / a))
  const a2 = Math.acosh(Math.max(1, R2 / a))
  if (inside) return { a, h: a * (a1 + a2), z0: a * a1 }
  // Neck before ring 1 when it is the smaller, after ring 2 otherwise.
  return R1 <= R2 ? { a, h: a * (a2 - a1), z0: -a * a1 } : { a, h: a * (a1 - a2), z0: a * a1 }
}

const SAMPLES = 200

/** Largest stable h for these radii, and the parameter s where it is reached. */
export function catenoidLimit(R1: number, R2: number): { hMax: number; sMax: number } {
  let best = 1
  let hBest = -1
  for (let i = 0; i <= SAMPLES; i++) {
    const s = (2 * i) / SAMPLES
    const h = family(R1, R2, s).h
    if (h > hBest) { hBest = h; best = s }
  }
  // Golden-section refinement of the maximum.
  let lo = Math.max(0, best - 2 / SAMPLES)
  let hi = Math.min(2, best + 2 / SAMPLES)
  const g = (Math.sqrt(5) - 1) / 2
  let x1 = hi - g * (hi - lo)
  let x2 = lo + g * (hi - lo)
  let f1 = family(R1, R2, x1).h
  let f2 = family(R1, R2, x2).h
  for (let k = 0; k < 40; k++) {
    if (f1 > f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = family(R1, R2, x1).h }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = family(R1, R2, x2).h }
  }
  const sMax = (lo + hi) / 2
  return { hMax: Math.max(hBest, family(R1, R2, sMax).h), sMax }
}

/** The stable catenoid for (R1, R2, h), if any. */
export function solveCatenoid(R1: number, R2: number, h: number, out?: Catenoid): Catenoid {
  const res = out ?? { exists: false, R1, R2, h, hMax: 0, a: 0, z0: 0 }
  res.R1 = R1
  res.R2 = R2
  res.h = h
  const { hMax, sMax } = catenoidLimit(R1, R2)
  res.hMax = hMax
  res.exists = h < hMax
  // First crossing of h(s) = h on the stable part [0, sMax] (scan, then bisect).
  const target = Math.min(h, hMax)
  let lo = 0
  let hi = sMax
  const n = 64
  for (let i = 1; i <= n; i++) {
    const s = (sMax * i) / n
    if (family(R1, R2, s).h >= target) { lo = (sMax * (i - 1)) / n; hi = s; break }
  }
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2
    if (family(R1, R2, mid).h < target) lo = mid
    else hi = mid
  }
  const sol = family(R1, R2, (lo + hi) / 2)
  res.a = sol.a
  res.z0 = sol.z0
  return res
}

/** Radius at z ∈ [0, h]. */
export function catenoidRadius(c: Catenoid, z: number): number {
  return c.a * Math.cosh((z - c.z0) / c.a)
}

/** Smallest radius between the rings. */
export function neckRadius(c: Catenoid): number {
  if (c.z0 > 0 && c.z0 < c.h) return c.a
  return Math.min(c.R1, c.R2)
}
