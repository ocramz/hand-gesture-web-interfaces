// Pre- and post-processing for the YOLO26 hand-pose model: letterboxing, the input tensor and the
// end-to-end output ([1, 300, 69], already NMS-free). Pure functions, tested in tests/decode.test.ts.
import { MODEL_SIZE, NUM_KP, ROW_STRIDE, type Hand } from './types.ts'

export interface Letterbox {
  size: number
  scale: number
  padX: number
  padY: number
  /** The scaled frame's size inside the square. */
  w: number
  h: number
}

export function letterbox(srcW: number, srcH: number, size = MODEL_SIZE): Letterbox {
  const scale = Math.min(size / srcW, size / srcH)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  return { size, scale, padX: Math.floor((size - w) / 2), padY: Math.floor((size - h) / 2), w, h }
}

export function toModel(lb: Letterbox, x: number, y: number): [number, number] {
  return [x * lb.scale + lb.padX, y * lb.scale + lb.padY]
}

export function fromModel(lb: Letterbox, x: number, y: number): [number, number] {
  return [(x - lb.padX) / lb.scale, (y - lb.padY) / lb.scale]
}

/** RGBA bytes (size × size) → planar RGB floats in 0..1, the model's NCHW input. */
export function rgbaToChw(rgba: Uint8ClampedArray | Uint8Array, size: number, out: Float32Array): void {
  const n = size * size
  const k = 1 / 255
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = rgba[j] * k
    out[n + i] = rgba[j + 1] * k
    out[2 * n + i] = rgba[j + 2] * k
  }
}

function iou(a: Hand['box'], b: Hand['box']): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = ix * iy
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
  return union > 0 ? inter / union : 0
}

export interface DecodeOptions {
  confThreshold: number
  maxHands: number
  /** Duplicates are rare in end-to-end output; this is a cheap guard. */
  iouThreshold: number
  /** Multiplies the un-letterboxed coordinates (a frame downscaled before inference → source pixels). */
  srcScale: number
}

/** Hands above the threshold, most confident first, in source pixels. */
export function decodeHands(out: Float32Array, lb: Letterbox, opts: DecodeOptions): Hand[] {
  const rows = Math.floor(out.length / ROW_STRIDE)
  const picked: number[] = []
  for (let r = 0; r < rows; r++) if (out[r * ROW_STRIDE + 4] >= opts.confThreshold) picked.push(r)
  picked.sort((a, b) => out[b * ROW_STRIDE + 4] - out[a * ROW_STRIDE + 4])
  const s = opts.srcScale
  const hands: Hand[] = []
  for (const r of picked) {
    const o = r * ROW_STRIDE
    const [x1, y1] = fromModel(lb, out[o], out[o + 1])
    const [x2, y2] = fromModel(lb, out[o + 2], out[o + 3])
    const box: Hand['box'] = [x1 * s, y1 * s, x2 * s, y2 * s]
    if (hands.some(h => iou(h.box, box) > opts.iouThreshold)) continue
    const kp = new Float32Array(NUM_KP * 3)
    for (let k = 0; k < NUM_KP; k++) {
      const [x, y] = fromModel(lb, out[o + 6 + 3 * k], out[o + 7 + 3 * k])
      kp[3 * k] = x * s
      kp[3 * k + 1] = y * s
      kp[3 * k + 2] = out[o + 8 + 3 * k]
    }
    hands.push({ box, conf: out[o + 4], kp: canonicalize(kp).kp })
    if (hands.length >= opts.maxHands) break
  }
  return hands
}

/**
 * The model doesn't always use one keypoint order: depending on the image it emits either MediaPipe's
 * order or this permutation of it (thumb IP ↔ tip, and index MCP..tip + middle MCP ↔ middle PIP..tip +
 * ring MCP, PIP), which looks like a training-time flip_idx. It is its own inverse.
 */
export const SWAPPED_ORDER: readonly number[] = [0, 1, 2, 4, 3, 10, 11, 12, 13, 14, 5, 6, 7, 8, 9, 15, 16, 17, 18, 19, 20]
const IDENTITY_ORDER: readonly number[] = SWAPPED_ORDER.map((_, i) => i)
const THUMB_BONES: ReadonlyArray<readonly [number, number]> = [[1, 2], [2, 3], [3, 4]]
const FINGER_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16], [5, 9], [9, 13],
]

function bonesLength(kp: Float32Array, bones: ReadonlyArray<readonly [number, number]>, order: readonly number[]): number {
  let sum = 0
  for (const [a, b] of bones) {
    const i = order[a] * 3, j = order[b] * 3
    sum += Math.hypot(kp[i] - kp[j], kp[i + 1] - kp[j + 1])
  }
  return sum
}

/**
 * Puts a detection's keypoints in MediaPipe order. The thumb and the fingers are decided separately: the
 * reading whose bones are shorter wins (the wrong one zig-zags between fingers).
 */
export function canonicalize(kp: Float32Array): { kp: Float32Array; thumbSwapped: boolean; fingersSwapped: boolean } {
  const thumbSwapped = bonesLength(kp, THUMB_BONES, SWAPPED_ORDER) < bonesLength(kp, THUMB_BONES, IDENTITY_ORDER)
  const fingersSwapped = bonesLength(kp, FINGER_BONES, SWAPPED_ORDER) < bonesLength(kp, FINGER_BONES, IDENTITY_ORDER)
  const out = new Float32Array(kp.length)
  for (let m = 0; m < NUM_KP; m++) {
    const swap = (m === 3 || m === 4) ? thumbSwapped : (m >= 5 && m <= 14) ? fingersSwapped : false
    const src = (swap ? SWAPPED_ORDER[m] : m) * 3
    out[3 * m] = kp[src]
    out[3 * m + 1] = kp[src + 1]
    out[3 * m + 2] = kp[src + 2]
  }
  return { kp: out, thumbSwapped, fingersSwapped }
}
