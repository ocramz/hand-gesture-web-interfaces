// The two hands as 3D skeletons: a sphere per keypoint and a cylinder per bone, coloured by finger. Each
// keypoint sits at its HandView point, on the pixel the webcam saw it at, at the hand's depth.
import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, type Object3D } from 'three'
import { NUM_KP, SKELETON, type HandView } from '@ocramz/handpose'

/** Sphere and bone radii, metres. */
const JOINT_R = 0.009
const BONE_R = 0.0045

const PALM = 0
/** Palm (wrist and the knuckle line), thumb, index, middle, ring, pinky. */
const FINGER_COLORS = ['#f4f1ea', '#ff9a3c', '#ffd93c', '#5fe08a', '#3cc8ff', '#c77dff'].map(c => new Color(c))
const KNUCKLES = new Set([0, 5, 9, 13, 17])

/** 0 for the wrist, else 1..5 for thumb..pinky. */
export function fingerOf(k: number): number {
  return k === 0 ? PALM : Math.floor((k - 1) / 4) + 1
}

/** Bones between two knuckles (wrist included) outline the palm; every other bone takes its distal joint's finger. */
export function boneFinger(a: number, b: number): number {
  return KNUCKLES.has(a) && KNUCKLES.has(b) ? PALM : fingerOf(b)
}

const _d = new Vector3()
const _m = new Vector3()
const _q = new Quaternion()
const _s = new Vector3()
const UP = new Vector3(0, 1, 0)

/** The instance matrix that stretches a unit cylinder (radius 1, height 1, along y, centred) from a to b. */
export function boneMatrix(a: Vector3, b: Vector3, radius: number, out: Matrix4): Matrix4 {
  _d.subVectors(b, a)
  const len = _d.length()
  _m.addVectors(a, b).multiplyScalar(0.5)
  if (len > 1e-9) _q.setFromUnitVectors(UP, _d.divideScalar(len))
  else _q.identity()
  return out.compose(_m, _q, _s.set(radius, len, radius))
}

export class HandSkeleton {
  readonly joints: InstancedMesh
  readonly bones: InstancedMesh
  private readonly pts = Array.from({ length: NUM_KP }, () => new Vector3())
  private readonly mat = new Matrix4()

  constructor(parent: Object3D) {
    const material = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 })
    this.joints = new InstancedMesh(new SphereGeometry(1, 24, 16), material, 2 * NUM_KP)
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 16, 1, true), material, 2 * SKELETON.length)
    for (let h = 0; h < 2; h++) {
      for (let k = 0; k < NUM_KP; k++) this.joints.setColorAt(h * NUM_KP + k, FINGER_COLORS[fingerOf(k)])
      SKELETON.forEach(([a, b], i) => this.bones.setColorAt(h * SKELETON.length + i, FINGER_COLORS[boneFinger(a, b)]))
    }
    for (const m of [this.joints, this.bones]) {
      m.frustumCulled = false
      parent.add(m)
    }
  }

  update(views: readonly HandView[]): void {
    views.forEach((view, h) => {
      // Grows in and shrinks out with the hand's presence.
      const s = view.presence
      for (let k = 0; k < NUM_KP; k++) {
        if (s > 0) view.point(k, this.pts[k])
        this.mat.makeScale(JOINT_R * s, JOINT_R * s, JOINT_R * s).setPosition(this.pts[k])
        this.joints.setMatrixAt(h * NUM_KP + k, this.mat)
      }
      SKELETON.forEach(([a, b], i) => {
        boneMatrix(this.pts[a], this.pts[b], BONE_R * s, this.mat)
        if (s === 0) this.mat.makeScale(0, 0, 0)
        this.bones.setMatrixAt(h * SKELETON.length + i, this.mat)
      })
    })
    this.joints.instanceMatrix.needsUpdate = true
    this.bones.instanceMatrix.needsUpdate = true
  }
}
