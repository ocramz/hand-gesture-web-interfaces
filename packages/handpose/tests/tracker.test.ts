// node tests/tracker.test.ts — slot assignment, hysteresis and smoothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HandTracker, OneEuro } from '../src/pose/tracker.ts'
import type { Hand } from '../src/pose/types.ts'

function hand(x: number, y = 300, conf = 0.9): Hand {
  const kp = new Float32Array(63)
  for (let k = 0; k < 21; k++) kp.set([x + k, y - k, 1], 3 * k)
  return { box: [x - 50, y - 100, x + 50, y + 100], conf, kp }
}

test('two hands go to screen-left and screen-right slots, mirrored', () => {
  const tr = new HandTracker()
  // Mirror: source x = 1000 is screen-left on a 1280-wide frame.
  for (let f = 0; f < 3; f++) tr.update([hand(200), hand(1000)], f / 30, 1280, true)
  assert.ok(tr.slots[0].active && tr.slots[1].active)
  assert.ok(Math.abs(tr.slots[0].kp[0] - 1000) < 1)
  assert.ok(Math.abs(tr.slots[1].kp[0] - 200) < 1)
  // Input order doesn't matter.
  tr.update([hand(1000), hand(200)], 3 / 30, 1280, true)
  assert.ok(Math.abs(tr.slots[0].kp[0] - 1000) < 1)
})

test('appear after minHits, disappear after maxMisses, keep a lone hand in its slot', () => {
  const tr = new HandTracker({ minHits: 2, maxMisses: 3 })
  tr.update([hand(300)], 0, 1280, false)
  assert.equal(tr.slots[0].active, false)
  tr.update([hand(300)], 0.033, 1280, false)
  assert.equal(tr.slots[0].active, true)
  // The lone hand drifts right past the middle: it stays in slot 0.
  for (let f = 2; f < 10; f++) tr.update([hand(300 + f * 50)], f * 0.033, 1280, false)
  assert.equal(tr.slots[0].active, true)
  assert.equal(tr.slots[1].active, false)
  tr.update([], 0.4, 1280, false)
  tr.update([], 0.43, 1280, false)
  assert.equal(tr.slots[0].active, true)
  tr.update([], 0.46, 1280, false)
  assert.equal(tr.slots[0].active, false)
})

test('OneEuro smooths jitter and follows a step', () => {
  const f = new OneEuro(1, 0.0)
  let y = 0
  for (let i = 0; i < 60; i++) y = f.filter(i % 2 ? 1 : -1, i / 30)
  assert.ok(Math.abs(y) < 0.5)
  for (let i = 60; i < 150; i++) y = f.filter(100, i / 30)
  assert.ok(Math.abs(y - 100) < 1)
})
