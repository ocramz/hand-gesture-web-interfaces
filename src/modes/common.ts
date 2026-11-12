import { MeshBasicMaterial, Mesh, SphereGeometry, type Vector3 } from 'three'
import type { Bubbles } from '../render/bubbles.ts'
import type { Droplets } from '../render/droplets.ts'
import type { HandView } from '../hands.ts'
import type { Finger } from '../pose/types.ts'

export interface ShapeParams {
  fingers: [Finger, Finger, Finger]
  /** 0: rings face each other; 1: they face the camera. */
  tilt: number
  pop: boolean
  relax: boolean
  relaxIterations: number
  /** Saddle: how far the free edges bow inward. */
  sag: number
}

export interface Effects {
  droplets: Droplets
  bubbles: Bubbles
}

export interface Shape {
  /** What the status line shows. */
  readonly label: string
  update(dt: number, t: number, hands: readonly [HandView, HandView], p: ShapeParams, fx: Effects): void
  /** Fingertip positions that can pop free bubbles. */
  pokers(): Vector3[]
  setEnabled(on: boolean): void
}

export const wireMaterial = new MeshBasicMaterial({ color: 0xe6f4ff, transparent: true, opacity: 0.7, depthWrite: false })
const tipGeometry = new SphereGeometry(1, 16, 12)
const tipMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })

export function tipMarker(): Mesh {
  const m = new Mesh(tipGeometry, tipMaterial)
  m.scale.setScalar(0.0035)
  m.visible = false
  return m
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
