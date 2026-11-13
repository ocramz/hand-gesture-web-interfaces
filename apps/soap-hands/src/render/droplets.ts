// Droplets flung off a popping film: a fixed pool of points under gravity and drag.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three'

export class Droplets {
  readonly points: Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly color: Float32Array
  private readonly material: ShaderMaterial
  private next = 0

  constructor(count = 900) {
    const n = count
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.life = new Float32Array(n)
    this.color = new Float32Array(n * 3)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.pos, 3))
    geo.setAttribute('aLife', new BufferAttribute(this.life, 1))
    geo.setAttribute('aColor', new BufferAttribute(this.color, 3))
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vLife = aLife;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife > 0.0 ? uScale * 0.0035 / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = dot(c, c);
          if (r > 0.25) discard;
          float a = smoothstep(0.25, 0.0, r) * clamp(vLife * 2.0, 0.0, 1.0);
          gl_FragColor = vec4(vColor * a, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.points = new Points(geo, this.material)
    this.points.frustumCulled = false
  }

  /** Pixels per metre at depth 1 (projection scale × canvas height / 2). */
  setScale(pxPerMetreAtUnitDepth: number): void { this.material.uniforms.uScale.value = pxPerMetreAtUnitDepth }

  private emit(p: Vector3, v: Vector3, life: number): void {
    const i = this.next
    this.next = (this.next + 1) % this.life.length
    this.pos.set([p.x, p.y, p.z], i * 3)
    this.vel.set([v.x, v.y, v.z], i * 3)
    this.life[i] = life
    // Iridescent tints.
    const h = Math.random()
    this.color.set([0.6 + 0.4 * Math.cos(6.283 * h), 0.6 + 0.4 * Math.cos(6.283 * (h + 0.33)), 0.6 + 0.4 * Math.cos(6.283 * (h + 0.67))], i * 3)
  }

  /** A ring of droplets flying outward from a circle (centre, axes e1 e2, radius). */
  burstRing(center: Vector3, e1: Vector3, e2: Vector3, radius: number, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2
      const dir = _d.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th))
      const p = _p.copy(center).addScaledVector(dir, radius * (0.8 + 0.3 * Math.random()))
      const v = _v.copy(dir).multiplyScalar(speed * (0.4 + Math.random()))
      v.x += (Math.random() - 0.5) * speed * 0.6
      v.y += (Math.random() - 0.2) * speed * 0.6
      v.z += (Math.random() - 0.5) * speed * 0.6
      this.emit(p, v, 0.5 + Math.random() * 0.6)
    }
  }

  /** Droplets flying off a sphere's surface. */
  burstSphere(center: Vector3, radius: number, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const dir = _d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      this.emit(_p.copy(center).addScaledVector(dir, radius), _v.copy(dir).multiplyScalar(speed * (0.3 + Math.random())), 0.4 + Math.random() * 0.5)
    }
  }

  update(dt: number): void {
    const { pos, vel, life } = this
    const drag = Math.exp(-2.5 * dt)
    for (let i = 0; i < life.length; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      const o = i * 3
      vel[o] *= drag; vel[o + 1] = vel[o + 1] * drag - 2.5 * dt; vel[o + 2] *= drag
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.aLife.needsUpdate = true
    g.attributes.aColor.needsUpdate = true
  }
}

const _d = new Vector3()
const _p = new Vector3()
const _v = new Vector3()
