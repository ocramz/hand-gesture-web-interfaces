// node tests/lift.test.ts — hand depth, ring normals, circumcircles and ray/plane intersection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CameraModel } from '../src/camera.ts'
import { circumcircle, handDepth, raysOnPlane, ringNormal } from '../src/lift.ts'
import { addScaledVec3, crossVec3, distanceVec3, dotVec3, lengthVec3, normalizeVec3, scaleVec3, vec3, type Vec3 } from '../src/vec3.ts'

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

const toCamera = (p: Vec3) => normalizeVec3(vec3(), scaleVec3(vec3(), p, -1))

test('circumcircle', () => {
  const c = vec3(0.1, -0.2, -0.5)
  const n = normalizeVec3(vec3(), vec3(0.3, 0.4, 0.8))
  const e1 = normalizeVec3(vec3(), addScaledVec3(vec3(), vec3(1, 0, 0), n, -n.x))
  const e2 = crossVec3(vec3(), n, e1)
  const R = 0.07
  const at = (th: number) => addScaledVec3(vec3(), addScaledVec3(vec3(), c, e1, R * Math.cos(th)), e2, R * Math.sin(th))
  const out = vec3()
  close(circumcircle(at(0.1), at(2.0), at(4.4), out), R, 1e-9)
  assert.ok(distanceVec3(out, c) < 1e-9)
  assert.ok(Number.isNaN(circumcircle(vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0), out)))
})

test('ringNormal: faces the partner, tipped to the camera, never edge-on', () => {
  const a = vec3(-0.15, 0, -0.5), b = vec3(0.15, 0, -0.5)
  const n = ringNormal(a, b, 0.3, 0.25, vec3())
  close(lengthVec3(n), 1)
  assert.ok(n.x > 0.5)
  const toCam = toCamera(a)
  assert.ok(dotVec3(n, toCam) >= 0.25 - 1e-9)
  // Hands near the image centre: facing straight at the partner would be nearly edge-on.
  const c = vec3(-0.05, 0, -0.5), d = vec3(0.25, 0, -0.5)
  const flat = ringNormal(c, d, 0, 0.25, vec3())
  close(dotVec3(flat, toCamera(c)), 0.25, 1e-9)
  close(lengthVec3(flat), 1, 1e-9)
  assert.ok(distanceVec3(ringNormal(a, null, 0.3, 0.25, vec3()), toCam) < 1e-12)
})

test('raysOnPlane refuses rays parallel to the plane', () => {
  const out = [vec3()]
  assert.equal(raysOnPlane([vec3(1, 0, 0)], vec3(0, 0, -1), vec3(0, 0, 1), out), false)
  assert.equal(raysOnPlane([vec3(0, 0, -1)], vec3(0, 0, -1), vec3(0, 0, 1), out), true)
  close(out[0].z, -1)
})
