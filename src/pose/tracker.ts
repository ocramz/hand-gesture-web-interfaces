// Turns per-frame detections into two stable hand slots (0 = left of the screen, 1 = right) with
// appear/disappear hysteresis and One-Euro smoothing of every keypoint. Pure; tests/tracker.test.ts.
import { NUM_KP, type Hand } from './types.ts'

/** One-Euro filter (Casiez et al. 2012): little lag when moving fast, little jitter when still. */
export class OneEuro {
  minCutoff: number
  beta: number
  dCutoff: number
  private x = 0
  private dx = 0
  private t = -1

  constructor(minCutoff = 1.2, beta = 0.015, dCutoff = 1) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  reset(): void { this.t = -1 }

  filter(x: number, t: number): number {
    if (this.t < 0 || t <= this.t) {
      if (this.t < 0) { this.x = x; this.dx = 0 }
      this.t = t
      return this.x
    }
    const dt = t - this.t
    this.t = t
    const ad = alpha(this.dCutoff, dt)
    this.dx += ad * ((x - this.x) / dt - this.dx)
    const a = alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt)
    this.x += a * (x - this.x)
    return this.x
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export interface Slot {
  /** Shown: seen in `minHits` frames running, and not yet missed `maxMisses` times running. */
  active: boolean
  /** Smoothed keypoints, source pixels, NUM_KP × (x, y, visibility). Held while the hand is briefly lost. */
  kp: Float32Array
  conf: number
  hits: number
  misses: number
  filters: OneEuro[]
}

export interface TrackerOptions {
  minHits: number
  maxMisses: number
  minCutoff: number
  beta: number
}

const DEFAULTS: TrackerOptions = { minHits: 2, maxMisses: 5, minCutoff: 1.2, beta: 0.015 }

function boxCenterX(h: Hand): number { return (h.box[0] + h.box[2]) / 2 }

export class HandTracker {
  readonly slots: [Slot, Slot]
  readonly opts: TrackerOptions

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
    const slot = (): Slot => ({
      active: false, kp: new Float32Array(NUM_KP * 3), conf: 0, hits: 0, misses: 0,
      filters: Array.from({ length: NUM_KP * 2 }, () => new OneEuro(this.opts.minCutoff, this.opts.beta)),
    })
    this.slots = [slot(), slot()]
  }

  /** The screen x of a source x: the selfie view mirrors it. */
  private static screenX(x: number, width: number, mirror: boolean): number { return mirror ? width - x : x }

  /** Assigns up to two detections (t in seconds) to the slots and smooths them. */
  update(hands: Hand[], t: number, width: number, mirror: boolean): void {
    const sx = (h: Hand) => HandTracker.screenX(boxCenterX(h), width, mirror)
    const assigned: [Hand | null, Hand | null] = [null, null]
    const two = hands.slice(0, 2)
    if (two.length === 2) {
      two.sort((a, b) => sx(a) - sx(b))
      assigned[0] = two[0]
      assigned[1] = two[1]
    } else if (two.length === 1) {
      const h = two[0]
      const x = sx(h)
      const live = this.slots.map(s => s.active || s.hits > 0)
      const slotX = this.slots.map(s => HandTracker.screenX(s.kp[0], width, mirror))
      let i: number
      if (live[0] && live[1]) i = Math.abs(slotX[0] - x) <= Math.abs(slotX[1] - x) ? 0 : 1
      else if (live[0] || live[1]) {
        const j = live[0] ? 0 : 1
        i = Math.abs(slotX[j] - x) < 0.25 * width ? j : 1 - j
      } else i = x < width / 2 ? 0 : 1
      assigned[i] = h
    }
    for (let i = 0; i < 2; i++) this.updateSlot(this.slots[i], assigned[i], t)
  }

  private updateSlot(s: Slot, h: Hand | null, t: number): void {
    if (!h) {
      s.hits = 0
      s.misses++
      if (s.misses >= this.opts.maxMisses) s.active = false
      return
    }
    const fresh = !s.active && s.hits === 0
    if (fresh) for (const f of s.filters) f.reset()
    s.misses = 0
    s.hits++
    if (s.hits >= this.opts.minHits) s.active = true
    s.conf = h.conf
    for (let k = 0; k < NUM_KP; k++) {
      s.kp[3 * k] = s.filters[2 * k].filter(h.kp[3 * k], t)
      s.kp[3 * k + 1] = s.filters[2 * k + 1].filter(h.kp[3 * k + 1], t)
      const v = h.kp[3 * k + 2]
      s.kp[3 * k + 2] = fresh ? v : s.kp[3 * k + 2] + 0.5 * (v - s.kp[3 * k + 2])
    }
  }
}
