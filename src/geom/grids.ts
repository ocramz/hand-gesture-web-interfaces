// Structured meshes for the films, and writers that place them: the catenoid tube between two rings, a
// Coons patch on four boundary curves, a disc on a ring. Positions are written in place every frame;
// topology, noise coordinates and fixed flags are built once.
import { Matrix4, Quaternion, Vector3 } from 'three'
import { catenoidRadius, type Catenoid } from './catenoid.ts'

export interface Grid {
  positions: Float32Array
  /** Coordinates for the shader's thickness noise, attached to the surface so swirls ride along. */
  noise: Float32Array
  index: Uint32Array
  /** Boundary vertices the relaxation must not move. */
  fixed: Uint8Array
  nu: number
  nv: number
}

/** nu around (periodic) × nv along; rows 0 and nv − 1 are the rings. Vertex (i, j) = j·nu + i. */
export function tubeGrid(nu: number, nv: number): Grid {
  const n = nu * nv
  const noise = new Float32Array(n * 3)
  const fixed = new Uint8Array(n)
  const index: number[] = []
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const v = j * nu + i
      const th = (2 * Math.PI * i) / nu
      noise.set([1.6 * Math.cos(th), 1.6 * Math.sin(th), (3 * j) / (nv - 1)], v * 3)
      if (j === 0 || j === nv - 1) fixed[v] = 1
      if (j < nv - 1) {
        const i1 = (i + 1) % nu
        const a = j * nu + i, b = j * nu + i1, c = (j + 1) * nu + i, d = (j + 1) * nu + i1
        index.push(a, b, d, a, d, c)
      }
    }
  }
  return { positions: new Float32Array(n * 3), noise, index: new Uint32Array(index), fixed, nu, nv }
}

/** nu × nv patch, all four edges fixed. Vertex (i, j) = j·nu + i. */
export function patchGrid(nu: number, nv: number): Grid {
  const n = nu * nv
  const noise = new Float32Array(n * 3)
  const fixed = new Uint8Array(n)
  const index: number[] = []
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const v = j * nu + i
      noise.set([(3 * i) / (nu - 1), (1.5 * j) / (nv - 1), 0.5], v * 3)
      if (i === 0 || j === 0 || i === nu - 1 || j === nv - 1) fixed[v] = 1
      if (i < nu - 1 && j < nv - 1) {
        const a = v, b = v + 1, c = v + nu, d = v + nu + 1
        // Alternate the diagonal so the patch has no preferred shear.
        if ((i + j) % 2 === 0) index.push(a, b, d, a, d, c)
        else index.push(a, b, c, b, d, c)
      }
    }
  }
  return { positions: new Float32Array(n * 3), noise, index: new Uint32Array(index), fixed, nu, nv }
}

/** A centre vertex plus nr rings of nu vertices; the outer ring is fixed. */
export function discGrid(nu: number, nr: number): Grid {
  const n = 1 + nu * nr
  const noise = new Float32Array(n * 3)
  const fixed = new Uint8Array(n)
  const index: number[] = []
  noise.set([0, 0, 0.3], 0)
  for (let r = 1; r <= nr; r++) {
    for (let i = 0; i < nu; i++) {
      const v = 1 + (r - 1) * nu + i
      const th = (2 * Math.PI * i) / nu
      const rr = (1.6 * r) / nr
      noise.set([rr * Math.cos(th), rr * Math.sin(th), 0.3], v * 3)
      if (r === nr) fixed[v] = 1
      const i1 = (i + 1) % nu
      if (r === 1) index.push(0, 1 + i, 1 + i1)
      else {
        const a = 1 + (r - 2) * nu + i, b = 1 + (r - 2) * nu + i1, c = 1 + (r - 1) * nu + i, d = 1 + (r - 1) * nu + i1
        index.push(a, c, d, a, d, b)
      }
    }
  }
  return { positions: new Float32Array(n * 3), noise, index: new Uint32Array(index), fixed, nu, nv: nr }
}

export interface RingFrame {
  center: Vector3
  normal: Vector3
  radius: number
}

/** In-plane axes for two rings with matching orientation, so the tube between them doesn't twist. */
export function ringAxes(r1: RingFrame, r2: RingFrame, out: { e1a: Vector3; e2a: Vector3; na: Vector3; e1b: Vector3; e2b: Vector3; nb: Vector3 }): void {
  const axis = _a.subVectors(r2.center, r1.center)
  if (axis.lengthSq() < 1e-12) axis.copy(r1.normal)
  axis.normalize()
  out.na.copy(r1.normal)
  if (out.na.dot(axis) < 0) out.na.negate()
  out.nb.copy(r2.normal)
  if (out.nb.dot(axis) < 0) out.nb.negate()
  // A reference direction across the axis: world up, or the view direction if up is along the axis.
  const ref = _b.set(0, 1, 0)
  if (Math.abs(ref.dot(axis)) > 0.9) ref.set(0, 0, 1)
  ref.addScaledVector(axis, -ref.dot(axis)).normalize()
  for (const [e1, e2, n] of [[out.e1a, out.e2a, out.na], [out.e1b, out.e2b, out.nb]] as const) {
    e1.copy(ref).addScaledVector(n, -ref.dot(n))
    if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0).addScaledVector(n, -n.x)
    e1.normalize()
    e2.crossVectors(n, e1)
  }
}

const axes = { e1a: new Vector3(), e2a: new Vector3(), na: new Vector3(), e1b: new Vector3(), e2b: new Vector3(), nb: new Vector3() }

/**
 * The catenoid-like tube between two rings: row centres on the segment between the ring centres, row
 * planes slerped from one ring's plane to the other's, row radii from the catenoid profile. Exact when
 * the rings are coaxial; the relaxation corrects tilts and offsets.
 */
export function writeCatenoid(g: Grid, r1: RingFrame, r2: RingFrame, cat: Catenoid): void {
  ringAxes(r1, r2, axes)
  _qa.setFromRotationMatrix(_m.makeBasis(axes.e1a, axes.e2a, axes.na))
  _qb.setFromRotationMatrix(_m.makeBasis(axes.e1b, axes.e2b, axes.nb))
  if (_qa.dot(_qb) < 0) _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w)
  const { nu, nv, positions: p } = g
  for (let j = 0; j < nv; j++) {
    const t = j / (nv - 1)
    _q.slerpQuaternions(_qa, _qb, t)
    const e1 = _e1.set(1, 0, 0).applyQuaternion(_q)
    const e2 = _e2.set(0, 1, 0).applyQuaternion(_q)
    const c = _c.lerpVectors(r1.center, r2.center, t)
    const r = j === 0 ? r1.radius : j === nv - 1 ? r2.radius : catenoidRadius(cat, t * cat.h)
    for (let i = 0; i < nu; i++) {
      const th = (2 * Math.PI * i) / nu
      const cs = Math.cos(th) * r, sn = Math.sin(th) * r
      const o = (j * nu + i) * 3
      p[o] = c.x + cs * e1.x + sn * e2.x
      p[o + 1] = c.y + cs * e1.y + sn * e2.y
      p[o + 2] = c.z + cs * e1.z + sn * e2.z
    }
  }
}

/** A flat disc spanning a ring. */
export function writeDisc(g: Grid, ring: RingFrame): void {
  const e1 = _e1.set(0, 1, 0)
  if (Math.abs(e1.dot(ring.normal)) > 0.9) e1.set(1, 0, 0)
  e1.addScaledVector(ring.normal, -e1.dot(ring.normal)).normalize()
  const e2 = _e2.crossVectors(ring.normal, e1)
  const { nu, nv: nr, positions: p } = g
  p[0] = ring.center.x; p[1] = ring.center.y; p[2] = ring.center.z
  for (let r = 1; r <= nr; r++) {
    const rr = (ring.radius * r) / nr
    for (let i = 0; i < nu; i++) {
      const th = (2 * Math.PI * i) / nu
      const cs = Math.cos(th) * rr, sn = Math.sin(th) * rr
      const o = (1 + (r - 1) * nu + i) * 3
      p[o] = ring.center.x + cs * e1.x + sn * e2.x
      p[o + 1] = ring.center.y + cs * e1.y + sn * e2.y
      p[o + 2] = ring.center.z + cs * e1.z + sn * e2.z
    }
  }
}

export type Curve = (t: number, out: Vector3) => Vector3

/**
 * Coons patch: S(u, v) from four boundary curves with matching corners:
 * left(v) = S(0, v), right(v) = S(1, v), bottom(u) = S(u, 0), top(u) = S(u, 1).
 */
export function writeCoons(g: Grid, left: Curve, right: Curve, bottom: Curve, top: Curve): void {
  const { nu, nv, positions: p } = g
  const p00 = left(0, _c00), p01 = left(1, _c01), p10 = right(0, _c10), p11 = right(1, _c11)
  for (let j = 0; j < nv; j++) {
    const v = j / (nv - 1)
    const l = left(v, _l), r = right(v, _r)
    for (let i = 0; i < nu; i++) {
      const u = i / (nu - 1)
      const b = bottom(u, _bt), t = top(u, _tp)
      const o = (j * nu + i) * 3
      for (let k = 0; k < 3; k++) {
        const P = (1 - u) * l.getComponent(k) + u * r.getComponent(k)
          + (1 - v) * b.getComponent(k) + v * t.getComponent(k)
          - ((1 - u) * (1 - v) * p00.getComponent(k) + u * (1 - v) * p10.getComponent(k)
            + (1 - u) * v * p01.getComponent(k) + u * v * p11.getComponent(k))
        p[o + k] = P
      }
    }
  }
}

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _e1 = new Vector3()
const _e2 = new Vector3()
const _m = new Matrix4()
const _q = new Quaternion()
const _qa = new Quaternion()
const _qb = new Quaternion()
const _c00 = new Vector3()
const _c01 = new Vector3()
const _c10 = new Vector3()
const _c11 = new Vector3()
const _l = new Vector3()
const _r = new Vector3()
const _bt = new Vector3()
const _tp = new Vector3()
