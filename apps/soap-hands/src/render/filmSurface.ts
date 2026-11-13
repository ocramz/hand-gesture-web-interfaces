// A film mesh over a Grid: its geometry, material and (optional) relaxation, with a residual carried
// from frame to frame so a few iterations per frame add up to a converged surface.
import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import type { Grid } from '../geom/grids.ts'
import { Relaxer } from '../geom/relax.ts'
import { createFilmMaterial, type FilmMaterial, type SharedFilmUniforms } from './filmMaterial.ts'

export class FilmSurface {
  readonly grid: Grid
  readonly mesh: Mesh
  readonly material: FilmMaterial
  readonly relaxer: Relaxer
  private readonly residual: Float32Array
  private readonly geometry: BufferGeometry
  private fadeTarget = 0

  constructor(grid: Grid, shared: SharedFilmUniforms) {
    this.grid = grid
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(grid.positions, 3))
    this.geometry.setAttribute('normal', new BufferAttribute(new Float32Array(grid.positions.length), 3))
    this.geometry.setAttribute('aNoise', new BufferAttribute(grid.noise, 3))
    this.geometry.setIndex(new BufferAttribute(grid.index, 1))
    this.material = createFilmMaterial(shared)
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.relaxer = new Relaxer(grid.positions.length / 3, grid.index, grid.fixed)
    this.residual = new Float32Array(grid.positions.length)
  }

  resetRelaxation(): void { this.residual.fill(0) }

  /**
   * Call after writing the analytic shape into grid.positions: adds last frame's correction, relaxes,
   * and keeps the new correction.
   */
  relax(iterations: number): void {
    const p = this.grid.positions
    const r = this.residual
    const fixed = this.grid.fixed
    if (iterations <= 0) return
    const base = _base.length >= p.length ? _base : (_base = new Float32Array(p.length))
    base.set(p)
    for (let i = 0; i < p.length; i++) if (!fixed[(i / 3) | 0]) p[i] += r[i] * 0.97
    this.relaxer.run(p, iterations, 0.6, 0.12)
    let ok = true
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { ok = false; break }
    if (!ok) { p.set(base.subarray(0, p.length)); r.fill(0); return }
    for (let i = 0; i < p.length; i++) r[i] = p[i] - base[i]
  }

  /** Uploads the positions, recomputes normals and the drainage frame. */
  commit(): void {
    const g = this.geometry
    g.attributes.position.needsUpdate = true
    g.computeVertexNormals()
    const p = this.grid.positions
    let minY = Infinity, maxY = -Infinity
    const c = _c.set(0, 0, 0)
    const n = p.length / 3
    for (let i = 0; i < p.length; i += 3) {
      c.x += p[i]; c.y += p[i + 1]; c.z += p[i + 2]
      minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1])
    }
    this.material.uniforms.uCenter.value.copy(c.multiplyScalar(1 / n))
    this.material.uniforms.uExtent.value = Math.max(0.01, (maxY - minY) / 2)
  }

  setFadeTarget(v: number): void { this.fadeTarget = v }
  get fade(): number { return this.material.uniforms.uFade.value }
  set fade(v: number) { this.material.uniforms.uFade.value = v }

  updateFade(dt: number, rate = 4): void {
    const u = this.material.uniforms.uFade
    const step = dt * rate
    u.value = u.value < this.fadeTarget ? Math.min(this.fadeTarget, u.value + step) : Math.max(this.fadeTarget, u.value - step)
    this.mesh.visible = u.value > 0.002
  }
}

let _base = new Float32Array(0)
const _c = new Vector3()
