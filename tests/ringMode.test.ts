// node tests/ringMode.test.ts — the ring shape's state machine with synthetic hands: a film forms, pops
// (droplets and a free bubble) when the hands pull apart, and re-forms when they come back together.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Vector3, type Mesh } from 'three'
import { CameraModel } from '../src/geom/camera.ts'
import { HandView } from '../src/hands.ts'
import { RingMode } from '../src/modes/ringMode.ts'
import type { ShapeParams } from '../src/modes/common.ts'
import { KP } from '../src/pose/types.ts'
import { Bubbles } from '../src/render/bubbles.ts'
import { Droplets } from '../src/render/droplets.ts'
import { sharedFilmUniforms } from '../src/render/filmMaterial.ts'

const cam = new CameraModel()
cam.set(1280, 720, 60, true)

/**
 * A cupped hand holding a ring: a 3D circle (centre x = cx m, depth 0.5 m, radius R) facing the other
 * hand (normal ±x, tipped toward the camera); its thumb, index and middle tips are three of its points,
 * seen through the camera.
 */
function setHand(v: HandView, cx: number, R: number, facing: 1 | -1): void {
  v.active = true
  v.presence = 1
  v.depth = 0.5
  const c = new Vector3(cx, 0, -0.5)
  const n = new Vector3(0.92 * facing, 0, 0.39).normalize()
  const e1 = new Vector3(0, 1, 0)
  const e2 = new Vector3().crossVectors(n, e1)
  const ths = [-2.2, 0.6, 1.6]
  ;[KP.thumbTip, KP.indexTip, KP.middleTip].forEach((k, i) => {
    const p = c.clone().addScaledVector(e1, R * Math.sin(ths[i])).addScaledVector(e2, R * Math.cos(ths[i]))
    // Project (mirrored view), then back to a ray: exactly what the app does with a detected pixel.
    const x = cam.width / 2 - (p.x / -p.z) * cam.f
    const y = cam.height / 2 - (p.y / -p.z) * cam.f
    cam.ray(x, y, v.rays[k])
  })
}

test('film forms, pops into discs + bubble when stretched, re-forms when the rings meet', () => {
  const shared = sharedFilmUniforms()
  const scene = new Group()
  const droplets = new Droplets()
  const bubbles = new Bubbles(shared, droplets, (m: Mesh) => scene.add(m), (m: Mesh) => scene.remove(m))
  const fx = { droplets, bubbles }
  const mode = new RingMode(shared)
  // Read through a function so TypeScript doesn't narrow the state across steps.
  const state = (): string => mode.state
  const hands: [HandView, HandView] = [new HandView(), new HandView()]
  const p: ShapeParams = { fingers: ['thumb', 'index', 'middle'], tilt: 0.3, pop: true, relax: true, relaxIterations: 6, sag: 0.1 }
  let t = 0
  // sep: distance between the ring centres (m); the rings have R = 4 cm, so the limit is ≈ 5.3 cm.
  const step = (sep: number) => {
    setHand(hands[0], -sep / 2, 0.04, 1)
    setHand(hands[1], sep / 2, 0.04, -1)
    t += 1 / 60
    mode.update(1 / 60, t, hands, p, fx)
    bubbles.update(1 / 60, t, [])
  }
  for (let i = 0; i < 30; i++) step(0.03)
  assert.equal(mode.state, 'film')
  assert.ok(mode.stretch < 0.95)
  const film = mode.group.children[0] as Mesh
  assert.ok(film.visible)
  let popAt = -1
  for (let sep = 0.03; sep < 0.3 && state() === 'film'; sep += 0.001) {
    step(sep)
    if (state() === 'popped') popAt = sep
  }
  assert.equal(mode.state, 'popped', `stretch ${mode.stretch}`)
  assert.ok(popAt > 0.045 && popAt < 0.07, `popped at ${popAt}`)
  assert.equal(bubbles.list.length, 1)
  assert.ok(mode.stretch >= 0.985)
  // Pulling further apart keeps it popped; nothing re-forms until the rings nearly touch.
  for (let i = 0; i < 20; i++) step(popAt + 0.05)
  assert.equal(mode.state, 'popped')
  let reformAt = -1
  for (let sep = popAt; sep > 0.002 && state() === 'popped'; sep -= 0.001) {
    step(sep)
    reformAt = sep
  }
  assert.equal(mode.state, 'film')
  assert.ok(reformAt < 0.03, `re-formed at ${reformAt}`)
  // Every vertex finite after all that relaxing.
  const pos = (film.geometry.attributes.position.array as Float32Array)
  assert.ok(pos.every(Number.isFinite))
  // Losing a hand ends the film without a pop.
  for (let i = 0; i < 10; i++) step(0.03)
  hands[1].active = false
  mode.update(1 / 60, t + 1 / 60, hands, p, fx)
  assert.equal(mode.state, 'none')
  assert.equal(bubbles.list.length, 1)
})

test('without popping the film just keeps stretching', () => {
  const shared = sharedFilmUniforms()
  const droplets = new Droplets()
  const bubbles = new Bubbles(shared, droplets, () => {}, () => {})
  const mode = new RingMode(shared)
  const hands: [HandView, HandView] = [new HandView(), new HandView()]
  const p: ShapeParams = { fingers: ['thumb', 'index', 'middle'], tilt: 0.3, pop: false, relax: true, relaxIterations: 6, sag: 0.1 }
  let t = 0
  for (let sep = 0.03; sep < 0.2; sep += 0.002) {
    setHand(hands[0], -sep / 2, 0.04, 1)
    setHand(hands[1], sep / 2, 0.04, -1)
    t += 1 / 60
    mode.update(1 / 60, t, hands, p, { droplets, bubbles })
  }
  assert.equal(mode.state, 'film')
  assert.equal(bubbles.list.length, 0)
})
