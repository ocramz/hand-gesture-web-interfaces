// Free bubbles released when a film pops: they float, drift, wobble and pop on a fingertip, at the end
// of their life or when they leave the view.
import { BufferAttribute, Mesh, SphereGeometry, Vector3 } from 'three'
import { createFilmMaterial, type FilmMaterial, type SharedFilmUniforms } from './filmMaterial.ts'
import type { Droplets } from './droplets.ts'

interface Bubble {
  mesh: Mesh
  material: FilmMaterial
  vel: Vector3
  age: number
  life: number
  radius: number
  grow: number
}

const MAX = 8

export class Bubbles {
  readonly list: Bubble[] = []
  private readonly geometry: SphereGeometry
  private readonly shared: SharedFilmUniforms
  private readonly droplets: Droplets
  private readonly add: (m: Mesh) => void
  private readonly remove: (m: Mesh) => void

  constructor(shared: SharedFilmUniforms, droplets: Droplets, add: (m: Mesh) => void, remove: (m: Mesh) => void) {
    this.shared = shared
    this.droplets = droplets
    this.add = add
    this.remove = remove
    this.geometry = new SphereGeometry(1, 64, 40)
    const n = this.geometry.attributes.normal
    const noise = new Float32Array(n.count * 3)
    for (let i = 0; i < n.count; i++) noise.set([n.getX(i) * 1.4, n.getY(i) * 1.4, n.getZ(i) * 1.4], i * 3)
    this.geometry.setAttribute('aNoise', new BufferAttribute(noise, 3))
  }

  spawn(center: Vector3, radius: number, vel: Vector3): void {
    if (this.list.length >= MAX) this.pop(this.list[0])
    const material = createFilmMaterial(this.shared)
    material.uniforms.uWobble.value = 0.035
    material.uniforms.uExtent.value = radius
    const mesh = new Mesh(this.geometry, material)
    mesh.position.copy(center)
    mesh.scale.setScalar(radius * 0.3)
    this.add(mesh)
    this.list.push({ mesh, material, vel: vel.clone(), age: 0, life: 5 + Math.random() * 4, radius, grow: 0 })
  }

  pop(b: Bubble): void {
    const i = this.list.indexOf(b)
    if (i < 0) return
    this.list.splice(i, 1)
    this.droplets.burstSphere(b.mesh.position, b.radius, 70, 0.6)
    this.remove(b.mesh)
    b.material.dispose()
  }

  clear(): void { for (const b of [...this.list]) this.pop(b) }

  /** `pokers`: fingertip positions that pop a bubble on contact. */
  update(dt: number, t: number, pokers: readonly Vector3[]): void {
    for (const b of [...this.list]) {
      b.age += dt
      b.grow = Math.min(1, b.grow + dt * 4)
      const s = b.radius * (0.3 + 0.7 * (1 - Math.pow(1 - b.grow, 3)))
      b.mesh.scale.setScalar(s)
      // Buoyant-ish drift with a little wander, damped.
      b.vel.y += 0.02 * dt
      b.vel.x += Math.sin(t * 0.9 + b.radius * 400) * 0.01 * dt
      b.vel.z += Math.cos(t * 0.7 + b.radius * 300) * 0.006 * dt
      b.vel.multiplyScalar(Math.exp(-0.6 * dt))
      b.mesh.position.addScaledVector(b.vel, dt)
      const m = b.material.uniforms
      m.uCenter.value.copy(b.mesh.position)
      m.uFade.value = Math.min(1, b.age * 3)
      m.uThin.value = Math.max(0, Math.min(1, (b.age - (b.life - 1.2)) / 1.2))
      const p = b.mesh.position
      const out = p.z > -0.05 || p.z < -4 || Math.abs(p.x / p.z) > 1.5 || Math.abs(p.y / p.z) > 1.2
      const poked = pokers.some(q => q.distanceTo(p) < s + 0.008)
      if (b.age > b.life || out || poked) this.pop(b)
    }
  }
}
