// node tests/packed.test.ts — unpacking the tract pipeline's flat result (Pipeline::pack in tract/src/pipeline.rs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unpackTracked } from '../src/pose/packed.ts'

test('unpackTracked reads n hands, then two slots', () => {
  const hand = [10, 20, 110, 220, 0.75, ...Array.from({ length: 63 }, (_, i) => i)]
  const slot0 = [1, 0.5, ...Array.from({ length: 63 }, (_, i) => 100 + i)]
  const slot1 = [0, 0, ...new Array(63).fill(0)]
  const { hands, slots } = unpackTracked(new Float32Array([1, ...hand, ...slot0, ...slot1]))
  assert.equal(hands.length, 1)
  assert.deepEqual(hands[0].box, [10, 20, 110, 220])
  assert.equal(hands[0].conf, 0.75)
  assert.equal(hands[0].kp.length, 63)
  assert.equal(hands[0].kp[62], 62)
  assert.equal(slots[0].active, true)
  assert.equal(slots[0].conf, 0.5)
  assert.equal(slots[0].kp[0], 100)
  assert.equal(slots[1].active, false)
})

test('unpackTracked rejects a result of the wrong length', () => {
  assert.throws(() => unpackTracked(new Float32Array([2, 0, 0])))
})
