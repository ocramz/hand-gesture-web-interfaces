// The demo's hand markers: a sphere per keypoint (fingertips larger), the bones as lines, and a ring held
// between the thumb and index tips that lights up when they pinch. Everything is placed at HandView.point,
// in camera space, so the Stage's matched camera draws it on the pixel the webcam saw the keypoint at: the
// debug overlay draws the same keypoints in 2D to compare. Sizes are in metres, so the markers shrink as
// the hand moves away.
import {
  BufferAttribute, BufferGeometry, Color, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, type Object3D,
} from 'three'
import { KP, NUM_KP, SKELETON, TIP, type HandView } from '@ocramz/handpose'

const JOINT_R = 0.004
const TIP_R = 0.0065
/** Thumb and index tips closer than this (metres) count as a pinch. */
export const PINCH_M = 0.03
/** The overlay's colours for slots 0 and 1 (drawDebug in @ocramz/handpose). */
const HAND_COLORS = [new Color(90 / 255, 220 / 255, 1), new Color(150 / 255, 1, 140 / 255)]
const PINCH_COLOR = new Color('#ff4f8b')
const TIPS = new Set(Object.values(TIP))

export interface HandReadout {
  active: boolean
  /** Distance from the camera, metres. */
  depth: number
  /** Thumb tip to index tip, metres. */
  pinch: number
}

export class HandMarkers {
  private readonly joints: InstancedMesh
  private readonly bones: LineSegments
  private readonly rings: InstancedMesh
  private readonly bonePos: BufferAttribute
  private readonly pts = [0, 1].map(() => Array.from({ length: NUM_KP }, () => new Vector3()))
  private readonly mat = new Matrix4()
  private readonly mid = new Vector3()
  private readonly readouts: HandReadout[] = [0, 1].map(() => ({ active: false, depth: NaN, pinch: NaN }))

  constructor(parent: Object3D) {
    this.joints = new InstancedMesh(new SphereGeometry(1, 20, 14), new MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 }), 2 * NUM_KP)
    for (let h = 0; h < 2; h++) for (let k = 0; k < NUM_KP; k++) this.joints.setColorAt(h * NUM_KP + k, HAND_COLORS[h])

    const n = 2 * SKELETON.length * 2
    this.bonePos = new BufferAttribute(new Float32Array(n * 3), 3)
    const boneColor = new BufferAttribute(new Float32Array(n * 3), 3)
    for (let v = 0; v < n; v++) HAND_COLORS[v < n / 2 ? 0 : 1].toArray(boneColor.array, v * 3)
    const geometry = new BufferGeometry().setAttribute('position', this.bonePos).setAttribute('color', boneColor)
    this.bones = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }))

    // TorusGeometry lies in the xy plane, facing the camera, like the plane every point of a hand is on
    // (HandView.point puts them all at the hand's depth): scaled to half the pinch distance and centred
    // between the tips, the ring passes through both.
    this.rings = new InstancedMesh(new TorusGeometry(1, 0.045, 10, 64), new MeshBasicMaterial({ transparent: true, opacity: 0.75 }), 2)
    for (let h = 0; h < 2; h++) this.rings.setColorAt(h, HAND_COLORS[h])

    for (const m of [this.joints, this.bones, this.rings]) {
      m.frustumCulled = false
      parent.add(m)
    }
  }

  update(views: readonly HandView[]): readonly HandReadout[] {
    views.forEach((view, h) => {
      const pts = this.pts[h]
      // Grows in and shrinks out with the hand's presence; keeps its last pose while it does.
      const s = view.presence
      if (s > 0) for (let k = 0; k < NUM_KP; k++) view.point(k, pts[k])
      for (let k = 0; k < NUM_KP; k++) {
        const r = (TIPS.has(k) ? TIP_R : JOINT_R) * s
        this.joints.setMatrixAt(h * NUM_KP + k, this.mat.makeScale(r, r, r).setPosition(pts[k]))
      }
      SKELETON.forEach(([a, b], i) => {
        const v = (h * SKELETON.length + i) * 2
        this.bonePos.setXYZ(v, pts[a].x, pts[a].y, pts[a].z)
        // A gone hand's bones collapse to points.
        const end = s > 0 ? pts[b] : pts[a]
        this.bonePos.setXYZ(v + 1, end.x, end.y, end.z)
      })
      const thumb = pts[KP.thumbTip]
      const index = pts[KP.indexTip]
      const pinch = thumb.distanceTo(index)
      const r = (pinch / 2) * s
      this.rings.setMatrixAt(h, this.mat.makeScale(r, r, r).setPosition(this.mid.addVectors(thumb, index).multiplyScalar(0.5)))
      this.rings.setColorAt(h, pinch < PINCH_M ? PINCH_COLOR : HAND_COLORS[h])
      const out = this.readouts[h]
      out.active = view.active
      out.depth = view.depth
      out.pinch = pinch
    })
    this.joints.instanceMatrix.needsUpdate = true
    this.rings.instanceMatrix.needsUpdate = true
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true
    this.bonePos.needsUpdate = true
    return this.readouts
  }
}
