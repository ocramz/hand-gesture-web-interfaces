// 2D keypoints → 3D. The model gives no depth, so: a hand's depth comes from its apparent palm size, and
// the points a shape needs (fingertips) are put on a plane through the hand whose normal is chosen (facing
// the other hand, tipped toward the camera). Intersecting each fingertip's camera ray with that plane
// keeps every 3D point exactly on its pixel. Tested in tests/lift.test.ts.
import { Vector3 } from 'three'
import type { CameraModel } from './camera.ts'

/** Palm segments with their typical adult length (m). Foreshortening only shortens them, so the longest
 * relative to its real length is the least foreshortened. */
export const PALM_SEGMENTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 5, 0.088], // wrist → index MCP
  [0, 9, 0.09], // wrist → middle MCP
  [0, 17, 0.078], // wrist → pinky MCP
  [5, 17, 0.066], // index MCP → pinky MCP
]

/** Depth (m, along −z) of a hand from its keypoints (source pixels). NaN if it has no size. */
export function handDepth(kp: Float32Array, cam: CameraModel, handScale = 1): number {
  let best = 0
  for (const [a, b, len] of PALM_SEGMENTS) {
    const px = Math.hypot(kp[3 * a] - kp[3 * b], kp[3 * a + 1] - kp[3 * b + 1])
    best = Math.max(best, px / (len * handScale))
  }
  return best > 0 ? cam.f / best : NaN
}

/**
 * The ring's normal: toward the partner hand, tipped toward the camera by `tilt`, and never closer than
 * `minFacing` (cosine) to edge-on, where fingertip rays would graze the plane. Alone, it faces the camera.
 */
export function ringNormal(anchor: Vector3, partner: Vector3 | null, tilt: number, minFacing: number, out: Vector3): Vector3 {
  const toCam = _a.copy(anchor).negate().normalize()
  if (!partner) return out.copy(toCam)
  const dir = _b.subVectors(partner, anchor).normalize()
  out.copy(dir).multiplyScalar(1 - tilt).addScaledVector(toCam, tilt).normalize()
  const facing = out.dot(toCam)
  if (facing < minFacing) {
    const side = out.addScaledVector(toCam, -facing)
    const len = side.length()
    if (len < 1e-6) return out.copy(toCam)
    side.multiplyScalar(Math.sqrt(1 - minFacing * minFacing) / len).addScaledVector(toCam, minFacing)
  }
  return out
}

/** Intersects rays (points at depth 1, from the camera at the origin) with the plane through `anchor`
 * with normal `n`. False if a ray misses (parallel, or behind the camera). */
export function raysOnPlane(rays: readonly Vector3[], anchor: Vector3, n: Vector3, out: Vector3[]): boolean {
  const d = n.dot(anchor)
  for (let i = 0; i < rays.length; i++) {
    const k = n.dot(rays[i])
    if (Math.abs(k) < 1e-6) return false
    const t = d / k
    if (t <= 0) return false
    out[i].copy(rays[i]).multiplyScalar(t)
  }
  return true
}

/** The circle through three 3D points: its radius (NaN if they are collinear), centre in `center`. */
export function circumcircle(a: Vector3, b: Vector3, c: Vector3, center: Vector3): number {
  const u = _a.subVectors(a, c)
  const v = _b.subVectors(b, c)
  const w = _c.crossVectors(u, v)
  const w2 = w.lengthSq()
  if (w2 < 1e-12 * u.lengthSq() * v.lengthSq() || w2 === 0) return NaN
  // centre = c + ((|u|² v − |v|² u) × w) / (2 |w|²)
  const m = _d.copy(v).multiplyScalar(u.lengthSq()).addScaledVector(u, -v.lengthSq())
  center.crossVectors(m, w).multiplyScalar(1 / (2 * w2)).add(c)
  return center.distanceTo(a)
}

export interface Ring {
  center: Vector3
  normal: Vector3
  radius: number
  /** The fingertips on the ring's plane. */
  tips: [Vector3, Vector3, Vector3]
  /** 0: the circle through the three tips; 1: centred on their centroid (they were nearly collinear). */
  fallback: number
  valid: boolean
}

export function newRing(): Ring {
  return {
    center: new Vector3(), normal: new Vector3(0, 0, 1), radius: 0,
    tips: [new Vector3(), new Vector3(), new Vector3()], fallback: 0, valid: false,
  }
}

export interface RingLimits { minRadius: number; maxRadius: number }

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Fits the ring through three fingertip rays on the plane through `anchor` with normal `n`. When the
 * tips are nearly collinear the circumcircle explodes, so it blends toward a circle around their
 * centroid.
 */
export function fitRing(rays: readonly [Vector3, Vector3, Vector3], anchor: Vector3, n: Vector3, limits: RingLimits, ring: Ring): boolean {
  ring.valid = false
  if (!raysOnPlane(rays, anchor, n, ring.tips)) return false
  const [a, b, c] = ring.tips
  const centroid = _e.copy(a).add(b).add(c).multiplyScalar(1 / 3)
  const spread = (a.distanceTo(centroid) + b.distanceTo(centroid) + c.distanceTo(centroid)) / 3
  if (spread < 1e-5) return false
  const r = circumcircle(a, b, c, _f)
  const w = Number.isFinite(r) ? smoothstep(1.4, 2.4, r / spread) : 1
  ring.fallback = w
  ring.center.copy(Number.isFinite(r) ? _f : centroid).lerp(centroid, w)
  ring.radius = (Number.isFinite(r) ? r : 0) * (1 - w) + spread * 1.15 * w
  ring.normal.copy(n)
  ring.valid = ring.radius >= limits.minRadius && ring.radius <= limits.maxRadius
  return ring.valid
}

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _d = new Vector3()
const _e = new Vector3()
const _f = new Vector3()
