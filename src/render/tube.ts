// A thin tube along a polyline (open or closed) whose vertices are rewritten each frame: ring wires,
// the saddle's thumb–index wires and its free edges.
import { BufferAttribute, BufferGeometry, Mesh, Vector3, type Material } from 'three'

export class Tube {
  readonly mesh: Mesh
  readonly points: Vector3[]
  private readonly closed: boolean
  private readonly sides: number
  private readonly pos: Float32Array
  private readonly nrm: Float32Array

  constructor(count: number, closed: boolean, material: Material, sides = 6) {
    this.closed = closed
    this.sides = sides
    this.points = Array.from({ length: count }, () => new Vector3())
    const n = count * sides
    this.pos = new Float32Array(n * 3)
    this.nrm = new Float32Array(n * 3)
    const index: number[] = []
    const segs = closed ? count : count - 1
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % count
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides
        const a = i * sides + k, b = i * sides + k1, c = i1 * sides + k, d = i1 * sides + k1
        index.push(a, c, d, a, d, b)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(this.pos, 3))
    geo.setAttribute('normal', new BufferAttribute(this.nrm, 3))
    geo.setIndex(index)
    this.mesh = new Mesh(geo, material)
    this.mesh.frustumCulled = false
  }

  /** Rebuilds the tube around `points` (set them first). */
  update(radius: number): void {
    const { points, sides, pos, nrm } = this
    const count = points.length
    let prevN: Vector3 | null = null
    for (let i = 0; i < count; i++) {
      const a = points[this.closed ? (i - 1 + count) % count : Math.max(0, i - 1)]
      const b = points[this.closed ? (i + 1) % count : Math.min(count - 1, i + 1)]
      const T = _t.subVectors(b, a)
      if (T.lengthSq() < 1e-16) T.set(1, 0, 0)
      T.normalize()
      // Carry the previous normal along (rotation-minimising enough for thin tubes).
      const N = _n.copy(prevN ?? (Math.abs(T.y) < 0.9 ? _up : _x))
      N.addScaledVector(T, -N.dot(T))
      if (N.lengthSq() < 1e-12) N.copy(Math.abs(T.y) < 0.9 ? _up : _x).addScaledVector(T, -T.y)
      N.normalize()
      const B = _bn.crossVectors(T, N)
      prevN = _pn.copy(N)
      const p = points[i]
      for (let k = 0; k < sides; k++) {
        const th = (2 * Math.PI * k) / sides
        const c = Math.cos(th), s = Math.sin(th)
        const o = (i * sides + k) * 3
        const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z
        nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz
        pos[o] = p.x + radius * nx; pos[o + 1] = p.y + radius * ny; pos[o + 2] = p.z + radius * nz
      }
    }
    const g = this.mesh.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.normal.needsUpdate = true
  }
}

const _t = new Vector3()
const _n = new Vector3()
const _bn = new Vector3()
const _pn = new Vector3()
const _up = new Vector3(0, 1, 0)
const _x = new Vector3(1, 0, 0)
