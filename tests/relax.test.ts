// node tests/relax.test.ts — area minimisation converges to the catenoid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { Relaxer } from '../src/geom/relax.ts'
import { patchGrid, tubeGrid, writeCatenoid, writeCoons } from '../src/geom/grids.ts'
import { solveCatenoid } from '../src/geom/catenoid.ts'

function cylinder(nu: number, nv: number, R: number, h: number) {
  const g = tubeGrid(nu, nv)
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const th = (2 * Math.PI * i) / nu
    g.positions.set([R * Math.cos(th), R * Math.sin(th), (h * j) / (nv - 1)], (j * nu + i) * 3)
  }
  return g
}

function neck(pos: Float32Array, nu: number, nv: number): number {
  let min = Infinity
  for (let j = 0; j < nv; j++) {
    let r = 0
    for (let i = 0; i < nu; i++) { const o = (j * nu + i) * 3; r += Math.hypot(pos[o], pos[o + 1]) }
    min = Math.min(min, r / nu)
  }
  return min
}

test('a cylinder between coaxial rings relaxes to the catenoid, area never rising', () => {
  const nu = 48, nv = 25
  const g = cylinder(nu, nv, 1, 1)
  const relax = new Relaxer(nu * nv, g.index, g.fixed)
  let area = relax.area(g.positions)
  for (let k = 0; k < 1500; k++) {
    relax.step(g.positions, 0.6, 0)
    const a = relax.area(g.positions)
    assert.ok(a <= area + 1e-9, `area rose at ${k}: ${area} → ${a}`)
    area = a
  }
  const a = solveCatenoid(1, 1, 1).a
  const n = neck(g.positions, nu, nv)
  assert.ok(Math.abs(n - a) / a < 0.02, `neck ${n} vs ${a}`)
})

test('the analytic start is already (nearly) stationary', () => {
  const nu = 64, nv = 33
  const g = tubeGrid(nu, nv)
  const cat = solveCatenoid(0.05, 0.05, 0.05)
  writeCatenoid(g, { center: new Vector3(0, 0, 0), normal: new Vector3(0, 0, 1), radius: 0.05 },
    { center: new Vector3(0, 0, 0.05), normal: new Vector3(0, 0, 1), radius: 0.05 }, cat)
  const before = neck(g.positions, nu, nv)
  const relax = new Relaxer(nu * nv, g.index, g.fixed)
  relax.run(g.positions, 200, 0.6, 0.15)
  const after = neck(g.positions, nu, nv)
  assert.ok(Math.abs(before - cat.a) / cat.a < 1e-3)
  assert.ok(Math.abs(after - before) / before < 0.01, `${before} → ${after}`)
})

test('a skew quadrilateral relaxes to a saddle of smaller area', () => {
  const g = patchGrid(24, 16)
  const P = [new Vector3(0, 0, 0), new Vector3(0, 1, 0.4), new Vector3(1, 0, 0.4), new Vector3(1, 1, 0)]
  const line = (a: Vector3, b: Vector3) => (t: number, o: Vector3) => o.lerpVectors(a, b, t)
  // Bow the bottom and top edges so the start is not already minimal.
  const bow = (a: Vector3, b: Vector3) => (t: number, o: Vector3) => o.lerpVectors(a, b, t).add(new Vector3(0, 0, 0.5 * Math.sin(Math.PI * t)))
  writeCoons(g, line(P[0], P[1]), line(P[2], P[3]), bow(P[0], P[2]), bow(P[1], P[3]))
  const relax = new Relaxer(24 * 16, g.index, g.fixed)
  const a0 = relax.area(g.positions)
  relax.run(g.positions, 300, 0.6, 0.15)
  const a1 = relax.area(g.positions)
  assert.ok(a1 < a0, `${a0} → ${a1}`)
  assert.ok(g.positions.every(Number.isFinite))
})
