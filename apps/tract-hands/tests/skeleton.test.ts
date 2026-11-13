// node tests/skeleton.test.ts — bone placement and colouring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, Vector3 } from 'three'
import { boneFinger, boneMatrix, fingerOf } from '../src/skeleton.ts'

const close = (a: Vector3, b: Vector3) => a.distanceTo(b) < 1e-9

test('boneMatrix stretches the unit cylinder from a to b', () => {
  const a = new Vector3(0.1, -0.2, -0.5)
  const b = new Vector3(-0.05, 0.03, -0.45)
  const m = boneMatrix(a, b, 0.004, new Matrix4())
  assert.ok(close(new Vector3(0, -0.5, 0).applyMatrix4(m), a))
  assert.ok(close(new Vector3(0, 0.5, 0).applyMatrix4(m), b))
  // The radius lies across the bone.
  const side = new Vector3(1, 0, 0).applyMatrix4(m).sub(new Vector3(0, 0, 0).applyMatrix4(m))
  assert.ok(Math.abs(side.length() - 0.004) < 1e-12)
  assert.ok(Math.abs(side.dot(b.clone().sub(a))) < 1e-12)
})

test('boneMatrix of a zero-length bone does not produce NaN', () => {
  const p = new Vector3(0.1, 0.2, -0.4)
  const m = boneMatrix(p, p.clone(), 0.004, new Matrix4())
  assert.ok(m.elements.every(Number.isFinite))
})

test('fingers: wrist is palm, then four joints per finger; knuckle-to-knuckle bones are palm', () => {
  assert.deepEqual([0, 1, 4, 5, 8, 9, 13, 17, 20].map(fingerOf), [0, 1, 1, 2, 2, 3, 4, 5, 5])
  assert.equal(boneFinger(5, 9), 0)
  assert.equal(boneFinger(0, 17), 0)
  assert.equal(boneFinger(0, 1), 1)
  assert.equal(boneFinger(19, 20), 5)
})
