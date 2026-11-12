// node tests/decode.test.ts — letterbox, input tensor, output decoding and keypoint-order repair.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalize, decodeHands, fromModel, letterbox, rgbaToChw, SWAPPED_ORDER, toModel } from '../src/pose/decode.ts'
import { NUM_KP, ROW_STRIDE } from '../src/pose/types.ts'

test('letterbox round-trips and centres the frame', () => {
  const lb = letterbox(1280, 720)
  assert.equal(lb.scale, 0.5)
  assert.equal(lb.w, 640)
  assert.equal(lb.h, 360)
  assert.equal(lb.padX, 0)
  assert.equal(lb.padY, 140)
  for (const [x, y] of [[0, 0], [1279, 719], [640, 360], [17.5, 600.25]]) {
    const [mx, my] = toModel(lb, x, y)
    const [sx, sy] = fromModel(lb, mx, my)
    assert.ok(Math.abs(sx - x) < 1e-9 && Math.abs(sy - y) < 1e-9)
  }
  const tall = letterbox(224, 400)
  assert.equal(tall.h, 640)
  assert.equal(tall.padY, 0)
  assert.equal(tall.padX, Math.floor((640 - tall.w) / 2))
})

test('rgbaToChw makes planar RGB in 0..1', () => {
  const rgba = new Uint8Array([255, 0, 51, 255, 0, 102, 255, 255])
  const out = new Float32Array(6)
  rgbaToChw(rgba, 1, out.subarray(0, 3))
  assert.deepEqual([...out.subarray(0, 3)].map(v => +v.toFixed(3)), [1, 0, 0.2])
  const two = new Float32Array(2 * 2 * 3)
  rgbaToChw(new Uint8Array(16).fill(255), 2, two)
  assert.ok(two.every(v => v === 1))
})

/** A plausible open hand (MediaPipe order), fingers up, in model pixels around (cx, cy). */
function handKp(cx: number, cy: number, s = 1): Float32Array {
  const pts: [number, number][] = [
    [0, 90], // wrist
    [-30, 70], [-50, 45], [-62, 22], [-72, 2], // thumb
    [-25, 0], [-28, -35], [-30, -58], [-32, -78], // index
    [0, -5], [0, -45], [0, -70], [0, -92], // middle
    [22, 0], [25, -35], [27, -58], [28, -76], // ring
    [42, 10], [48, -15], [52, -32], [55, -48], // pinky
  ]
  const kp = new Float32Array(NUM_KP * 3)
  pts.forEach(([x, y], k) => kp.set([cx + x * s, cy + y * s, 0.9], 3 * k))
  return kp
}

function row(out: Float32Array, r: number, conf: number, kp: Float32Array): void {
  const o = r * ROW_STRIDE
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (let k = 0; k < NUM_KP; k++) {
    x1 = Math.min(x1, kp[3 * k]); x2 = Math.max(x2, kp[3 * k])
    y1 = Math.min(y1, kp[3 * k + 1]); y2 = Math.max(y2, kp[3 * k + 1])
  }
  out.set([x1, y1, x2, y2, conf, 0], o)
  out.set(kp, o + 6)
}

function permute(kp: Float32Array): Float32Array {
  const out = new Float32Array(kp.length)
  for (let m = 0; m < NUM_KP; m++) out.set(kp.subarray(3 * SWAPPED_ORDER[m], 3 * SWAPPED_ORDER[m] + 3), 3 * m)
  return out
}

test('decodeHands: threshold, order, un-letterbox, duplicates', () => {
  const lb = letterbox(1280, 720)
  const out = new Float32Array(300 * ROW_STRIDE)
  row(out, 0, 0.5, handKp(200, 300))
  row(out, 1, 0.9, handKp(450, 320))
  row(out, 2, 0.85, handKp(451, 321)) // duplicate of row 1
  row(out, 3, 0.2, handKp(320, 320)) // below threshold
  const hands = decodeHands(out, lb, { confThreshold: 0.4, maxHands: 4, iouThreshold: 0.6, srcScale: 1 })
  assert.equal(hands.length, 2)
  assert.equal(hands[0].conf, out[1 * ROW_STRIDE + 4])
  // Wrist of row 1 at model (450, 410) → source ((450 − 0)/0.5, (410 − 140)/0.5).
  assert.ok(Math.abs(hands[0].kp[0] - 900) < 1e-3 && Math.abs(hands[0].kp[1] - 540) < 1e-3)
  const scaled = decodeHands(out, lb, { confThreshold: 0.4, maxHands: 1, iouThreshold: 0.6, srcScale: 2 })
  assert.equal(scaled.length, 1)
  assert.ok(Math.abs(scaled[0].kp[0] - 1800) < 1e-3)
})

test('canonicalize undoes the swapped keypoint order, per group, and keeps the canonical one', () => {
  const kp = handKp(300, 300)
  for (const s of [1, 0.5, 2]) {
    const k = handKp(300, 300, s)
    const same = canonicalize(k)
    assert.equal(same.thumbSwapped, false)
    assert.equal(same.fingersSwapped, false)
    assert.deepEqual([...same.kp], [...k])
    const fixed = canonicalize(permute(k))
    assert.equal(fixed.thumbSwapped, true)
    assert.equal(fixed.fingersSwapped, true)
    assert.deepEqual([...fixed.kp], [...k])
  }
  // Only the thumb swapped.
  const thumbOnly = new Float32Array(kp)
  thumbOnly.set(kp.subarray(12, 15), 9)
  thumbOnly.set(kp.subarray(9, 12), 12)
  const r = canonicalize(thumbOnly)
  assert.equal(r.thumbSwapped, true)
  assert.equal(r.fingersSwapped, false)
  assert.deepEqual([...r.kp], [...kp])
})
