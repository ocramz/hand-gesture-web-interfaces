// A ring through three fingertips: the circle through their rays' intersections with a chosen plane.
// Tested in tests/ring.test.ts.
import { Vector3 } from 'three'
import { circumcircle, raysOnPlane } from '@ocramz/handpose'

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

const _e = new Vector3()
const _f = new Vector3()
