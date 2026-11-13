// The tract pipeline's flat result (see `Pipeline::pack` in tract/src/pipeline.rs):
// [n, (x1, y1, x2, y2, conf, kp × 63) × n, (active, conf, kp × 63) × 2].
import type { TrackedSlot } from './tracker.ts'
import { NUM_KP, type Hand } from './types.ts'

const KP_LEN = 3 * NUM_KP
const HAND_LEN = 5 + KP_LEN
const SLOT_LEN = 2 + KP_LEN

export function unpackTracked(p: Float32Array): { hands: Hand[]; slots: [TrackedSlot, TrackedSlot] } {
  const n = p[0]
  if (p.length !== 1 + n * HAND_LEN + 2 * SLOT_LEN) throw new Error(`packed result has ${p.length} values for ${n} hands`)
  const hands: Hand[] = []
  for (let i = 0, o = 1; i < n; i++, o += HAND_LEN) {
    hands.push({ box: [p[o], p[o + 1], p[o + 2], p[o + 3]], conf: p[o + 4], kp: p.slice(o + 5, o + HAND_LEN) })
  }
  const slot = (o: number): TrackedSlot => ({ active: p[o] !== 0, conf: p[o + 1], kp: p.slice(o + 2, o + SLOT_LEN) })
  const s0 = 1 + n * HAND_LEN
  return { hands, slots: [slot(s0), slot(s0 + SLOT_LEN)] }
}
