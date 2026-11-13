// node tests/ring.test.ts — ring fitting through three fingertip rays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraModel } from '@ocramz/handpose'
import { fitRing, newRing } from '../src/geom/ring.ts'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)

test('fitRing puts the tips on their rays and on a circle with the requested normal', () => {
  const cam = new CameraModel()
  cam.set(1280, 720, 60, true)
  const D = 0.5
  // A tilted 3D circle; project three of its points to pixels; fit from the pixels.
  const c = new Vector3(-0.1, 0.02, -D)
  const n = new Vector3(0.8, 0.1, 0.45).normalize()
  const e1 = new Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize()
  const e2 = new Vector3().crossVectors(n, e1)
  const R = 0.05
  const pts = [0.3, 2.2, 4.0].map(th => c.clone().addScaledVector(e1, R * Math.cos(th)).addScaledVector(e2, R * Math.sin(th)))
  const pix = pts.map(p => {
    const x = p.x / -p.z, y = p.y / -p.z
    return [cam.width / 2 - x * cam.f, cam.height / 2 - y * cam.f] // mirrored
  })
  const rays = pix.map(([x, y]) => cam.ray(x, y)) as [Vector3, Vector3, Vector3]
  const ring = newRing()
  assert.ok(fitRing(rays, c, n, { minRadius: 0.01, maxRadius: 0.3 }, ring))
  close(ring.radius, R, 1e-6)
  assert.ok(ring.center.distanceTo(c) < 1e-6)
  for (let i = 0; i < 3; i++) {
    assert.ok(ring.tips[i].distanceTo(pts[i]) < 1e-6)
    // On its ray: parallel to the pixel's ray.
    assert.ok(new Vector3().crossVectors(ring.tips[i], rays[i]).length() / ring.tips[i].length() < 1e-9)
  }
  // Nearly collinear tips fall back to a circle around their centroid instead of exploding.
  const line = [[600, 300], [610, 360], [620, 421]].map(([x, y]) => cam.ray(x, y)) as [Vector3, Vector3, Vector3]
  const r2 = newRing()
  fitRing(line, new Vector3(0, 0, -D), new Vector3(0, 0, 1), { minRadius: 0.01, maxRadius: 0.3 }, r2)
  assert.ok(r2.fallback > 0.99)
  assert.ok(r2.radius < 0.1)
})
