// node tests/lift.test.ts — hand depth, ring normals, circumcircles and ray/plane intersection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraModel } from '../src/camera.ts'
import { circumcircle, handDepth, raysOnPlane, ringNormal } from '../src/lift.ts'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)

test('camera rays and cover fit agree with the canvas mapping', () => {
  const cam = new CameraModel()
  cam.set(1280, 720, 60, true)
  const r = cam.ray(640, 360)
  assert.deepEqual([r.x, r.y, r.z], [-0, -0, -1])
  // A point right of centre in the source appears left on screen (mirror), so its ray has x < 0.
  assert.ok(cam.ray(900, 360).x < 0)
  // Project the ray's point with the cover-fit camera: it must land where toCanvas puts the pixel.
  const cw = 1000, ch = 900
  const { fovDeg } = cam.coverFit(cw, ch)
  const t = Math.tan((fovDeg * Math.PI) / 360)
  for (const [x, y] of [[100, 50], [1200, 700], [640, 360]]) {
    const p = cam.ray(x, y)
    const ndcX = p.x / -p.z / (t * (cw / ch))
    const ndcY = p.y / -p.z / t
    const [sx, sy] = cam.toCanvas(x, y, cw, ch)
    close((ndcX + 1) * cw / 2, sx, 1e-6)
    close((1 - ndcY) * ch / 2, sy, 1e-6)
  }
})

test('handDepth inverts the projection of a palm facing the camera', () => {
  const cam = new CameraModel()
  cam.set(1280, 720, 60, false)
  const D = 0.55
  const kp = new Float32Array(63)
  // Palm in the plane z = −D: wrist, index MCP, middle MCP, pinky MCP at their typical lengths.
  const pts: Record<number, [number, number]> = { 0: [0, -0.09], 5: [-0.033, -0.0084], 9: [0, 0], 17: [0.033, -0.0186] }
  for (const [k, [X, Y]] of Object.entries(pts)) {
    kp[3 * +k] = 640 + (cam.f * X) / D
    kp[3 * +k + 1] = 360 - (cam.f * Y) / D
  }
  const d = handDepth(kp, cam)
  assert.ok(Math.abs(d - D) / D < 0.08, `depth ${d}`)
  assert.ok(Math.abs(handDepth(kp, cam, 1.2) - 1.2 * d) < 1e-9)
})

test('circumcircle', () => {
  const c = new Vector3(0.1, -0.2, -0.5)
  const n = new Vector3(0.3, 0.4, 0.8).normalize()
  const e1 = new Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize()
  const e2 = new Vector3().crossVectors(n, e1)
  const R = 0.07
  const at = (th: number) => c.clone().addScaledVector(e1, R * Math.cos(th)).addScaledVector(e2, R * Math.sin(th))
  const out = new Vector3()
  close(circumcircle(at(0.1), at(2.0), at(4.4), out), R, 1e-9)
  assert.ok(out.distanceTo(c) < 1e-9)
  assert.ok(Number.isNaN(circumcircle(new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0), out)))
})

test('ringNormal: faces the partner, tipped to the camera, never edge-on', () => {
  const a = new Vector3(-0.15, 0, -0.5), b = new Vector3(0.15, 0, -0.5)
  const n = ringNormal(a, b, 0.3, 0.25, new Vector3())
  close(n.length(), 1)
  assert.ok(n.x > 0.5)
  const toCam = a.clone().negate().normalize()
  assert.ok(n.dot(toCam) >= 0.25 - 1e-9)
  // Hands near the image centre: facing straight at the partner would be nearly edge-on.
  const c = new Vector3(-0.05, 0, -0.5), d = new Vector3(0.25, 0, -0.5)
  const flat = ringNormal(c, d, 0, 0.25, new Vector3())
  close(flat.dot(c.clone().negate().normalize()), 0.25, 1e-9)
  close(flat.length(), 1, 1e-9)
  assert.ok(ringNormal(a, null, 0.3, 0.25, new Vector3()).distanceTo(toCam) < 1e-12)
})

test('raysOnPlane refuses rays parallel to the plane', () => {
  const out = [new Vector3()]
  assert.equal(raysOnPlane([new Vector3(1, 0, 0)], new Vector3(0, 0, -1), new Vector3(0, 0, 1), out), false)
  assert.equal(raysOnPlane([new Vector3(0, 0, -1)], new Vector3(0, 0, -1), new Vector3(0, 0, 1), out), true)
  close(out[0].z, -1)
})
