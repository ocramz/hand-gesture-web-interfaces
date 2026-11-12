// The hand-pose model's keypoints: Ultralytics Hand Keypoints (MediaPipe's 21-point layout).

export const NUM_KP = 21
/** One output row: x1, y1, x2, y2, conf, class, then (x, y, visibility) per keypoint. */
export const ROW_STRIDE = 6 + NUM_KP * 3
export const MODEL_SIZE = 640

export const KP = {
  wrist: 0,
  thumbCmc: 1, thumbMcp: 2, thumbIp: 3, thumbTip: 4,
  indexMcp: 5, indexPip: 6, indexDip: 7, indexTip: 8,
  middleMcp: 9, middlePip: 10, middleDip: 11, middleTip: 12,
  ringMcp: 13, ringPip: 14, ringDip: 15, ringTip: 16,
  pinkyMcp: 17, pinkyPip: 18, pinkyDip: 19, pinkyTip: 20,
} as const

export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
export const TIP: Record<Finger, number> = {
  thumb: KP.thumbTip, index: KP.indexTip, middle: KP.middleTip, ring: KP.ringTip, pinky: KP.pinkyTip,
}

/** Bones, for drawing. */
export const SKELETON: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

/** A detected hand, in source-frame pixels (not mirrored). */
export interface Hand {
  box: [number, number, number, number]
  conf: number
  /** NUM_KP × (x, y, visibility). */
  kp: Float32Array
}

export type Precision = 'fp16' | 'fp32'
export type Backend = 'webgpu' | 'wasm'

export type ToWorker =
  | { type: 'init'; urls: Record<Precision, string>; backend: Backend | 'auto'; precision: Precision | 'auto'; confThreshold: number }
  | { type: 'frame'; bitmap: ImageBitmap; srcW: number; srcH: number; t: number }
  | { type: 'config'; confThreshold: number }

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready'; backend: Backend; precision: Precision; threads: number; note: string }
  | { type: 'error'; message: string }
  | { type: 'result'; hands: Hand[]; t: number; inferMs: number; prepMs: number }
