// 2D keypoints → 3D. The model gives no depth, so: a hand's depth comes from its apparent palm size, and
// the points a shape needs (fingertips) are put on a plane through the hand whose normal is chosen (facing
// the other hand, tipped toward the camera). Intersecting each fingertip's camera ray with that plane
// keeps every 3D point exactly on its pixel. Tested in tests/lift.test.ts.
import type { CameraModel } from './camera.ts'
import {
  addScaledVec3, copyVec3, crossVec3, distanceVec3, dotVec3, lengthSqVec3, lengthVec3, normalizeVec3, scaleVec3, subVec3, vec3,
  type Vec3,
} from './vec3.ts'

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
export function ringNormal<T extends Vec3>(anchor: Vec3, partner: Vec3 | null, tilt: number, minFacing: number, out: T): T {
  const toCam = normalizeVec3(_a, scaleVec3(_a, anchor, -1))
  if (!partner) return copyVec3(out, toCam)
  const dir = normalizeVec3(_b, subVec3(_b, partner, anchor))
  normalizeVec3(out, addScaledVec3(out, scaleVec3(out, dir, 1 - tilt), toCam, tilt))
  const facing = dotVec3(out, toCam)
  if (facing < minFacing) {
    const side = addScaledVec3(out, out, toCam, -facing)
    const len = lengthVec3(side)
    if (len < 1e-6) return copyVec3(out, toCam)
    addScaledVec3(out, scaleVec3(out, side, Math.sqrt(1 - minFacing * minFacing) / len), toCam, minFacing)
  }
  return out
}

/** Intersects rays (points at depth 1, from the camera at the origin) with the plane through `anchor`
 * with normal `n`. False if a ray misses (parallel, or behind the camera). */
export function raysOnPlane(rays: readonly Vec3[], anchor: Vec3, n: Vec3, out: readonly Vec3[]): boolean {
  const d = dotVec3(n, anchor)
  for (let i = 0; i < rays.length; i++) {
    const k = dotVec3(n, rays[i])
    if (Math.abs(k) < 1e-6) return false
    const t = d / k
    if (t <= 0) return false
    scaleVec3(out[i], rays[i], t)
  }
  return true
}

/** The circle through three 3D points: its radius (NaN if they are collinear), centre in `center`. */
export function circumcircle(a: Vec3, b: Vec3, c: Vec3, center: Vec3): number {
  const u = subVec3(_a, a, c)
  const v = subVec3(_b, b, c)
  const w = crossVec3(_c, u, v)
  const w2 = lengthSqVec3(w)
  if (w2 < 1e-12 * lengthSqVec3(u) * lengthSqVec3(v) || w2 === 0) return NaN
  // centre = c + ((|u|² v − |v|² u) × w) / (2 |w|²)
  const m = addScaledVec3(_d, scaleVec3(_d, v, lengthSqVec3(u)), u, -lengthSqVec3(v))
  addScaledVec3(center, c, crossVec3(_d, m, w), 1 / (2 * w2))
  return distanceVec3(center, a)
}

const _a = vec3()
const _b = vec3()
const _c = vec3()
const _d = vec3()
