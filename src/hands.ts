// Per-slot hand state the shapes read: display-smoothed keypoints, a smoothed depth, and the 21 camera
// rays (points at depth 1). point(k) is keypoint k at the hand's depth.
import { Vector3 } from 'three'
import type { CameraModel } from './geom/camera.ts'
import { handDepth } from './geom/lift.ts'
import type { HandTracker } from './pose/tracker.ts'
import { NUM_KP } from './pose/types.ts'

export class HandView {
  active = false
  /** 0..1, eases in and out with `active`. */
  presence = 0
  depth = NaN
  readonly kp = new Float32Array(NUM_KP * 3)
  readonly rays: Vector3[] = Array.from({ length: NUM_KP }, () => new Vector3())
  private seeded = false

  point(k: number, out: Vector3): Vector3 { return out.copy(this.rays[k]).multiplyScalar(this.depth) }

  update(slotActive: boolean, slotKp: Float32Array, cam: CameraModel, dt: number, handScale: number): void {
    if (slotActive) {
      if (!this.seeded) {
        this.kp.set(slotKp)
        this.seeded = true
        this.depth = NaN
      } else {
        // The tracker updates at the model's rate; ease toward it at the render rate.
        const a = 1 - Math.exp(-dt / 0.03)
        for (let i = 0; i < this.kp.length; i++) this.kp[i] += a * (slotKp[i] - this.kp[i])
      }
      const d = handDepth(this.kp, cam, handScale)
      if (Number.isFinite(d)) {
        this.depth = Number.isFinite(this.depth) ? Math.exp(Math.log(this.depth) + (1 - Math.exp(-dt / 0.15)) * (Math.log(d) - Math.log(this.depth))) : d
      }
      for (let k = 0; k < NUM_KP; k++) cam.ray(this.kp[3 * k], this.kp[3 * k + 1], this.rays[k])
      this.active = Number.isFinite(this.depth)
    } else {
      this.active = false
      this.seeded = false
    }
    this.presence = Math.max(0, Math.min(1, this.presence + (this.active ? 1 : -1) * dt * 5))
  }
}

export function updateHandViews(views: readonly [HandView, HandView], tracker: HandTracker, cam: CameraModel, dt: number, handScale: number): void {
  for (let i = 0; i < 2; i++) views[i].update(tracker.slots[i].active, tracker.slots[i].kp, cam, dt, handScale)
}
