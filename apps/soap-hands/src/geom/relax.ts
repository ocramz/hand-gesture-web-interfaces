// Discrete area minimisation on a triangle mesh with fixed boundary vertices: each free vertex moves
// along its normal against the area gradient (a Jacobi-preconditioned mean-curvature step), plus a little
// tangential Laplacian smoothing that keeps the triangles well shaped. Tested in tests/relax.test.ts.

export class Relaxer {
  readonly count: number
  readonly tris: Uint32Array
  readonly fixed: Uint8Array
  private readonly grad: Float64Array
  private readonly nrm: Float64Array
  private readonly stiff: Float64Array
  private readonly nbrStart: Uint32Array
  private readonly nbr: Uint32Array

  constructor(count: number, tris: Uint32Array, fixed: Uint8Array) {
    this.count = count
    this.tris = tris
    this.fixed = fixed
    this.grad = new Float64Array(count * 3)
    this.nrm = new Float64Array(count * 3)
    this.stiff = new Float64Array(count)
    // Vertex neighbours from triangle edges.
    const sets: Set<number>[] = Array.from({ length: count }, () => new Set())
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]
      sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b)
    }
    this.nbrStart = new Uint32Array(count + 1)
    for (let i = 0; i < count; i++) this.nbrStart[i + 1] = this.nbrStart[i] + sets[i].size
    this.nbr = new Uint32Array(this.nbrStart[count])
    for (let i = 0; i < count; i++) this.nbr.set([...sets[i]], this.nbrStart[i])
  }

  /** Total area. */
  area(pos: Float32Array): number {
    let sum = 0
    const tris = this.tris
    for (let t = 0; t < tris.length; t += 3) {
      const i = tris[t] * 3, j = tris[t + 1] * 3, k = tris[t + 2] * 3
      const ux = pos[j] - pos[i], uy = pos[j + 1] - pos[i + 1], uz = pos[j + 2] - pos[i + 2]
      const vx = pos[k] - pos[i], vy = pos[k + 1] - pos[i + 1], vz = pos[k + 2] - pos[i + 2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      sum += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz)
    }
    return sum
  }

  /**
   * One step. `rate` ≤ 1 scales the preconditioned normal step (1 is a full Jacobi step); `smooth` is the
   * tangential Laplacian weight.
   */
  step(pos: Float32Array, rate = 0.6, smooth = 0.15): void {
    const { tris, grad, nrm, stiff, fixed } = this
    grad.fill(0)
    nrm.fill(0)
    stiff.fill(0)
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2]
      const i = a * 3, j = b * 3, k = c * 3
      const ux = pos[j] - pos[i], uy = pos[j + 1] - pos[i + 1], uz = pos[j + 2] - pos[i + 2]
      const vx = pos[k] - pos[i], vy = pos[k + 1] - pos[i + 1], vz = pos[k + 2] - pos[i + 2]
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (len < 1e-14) continue
      nrm[i] += nx; nrm[i + 1] += ny; nrm[i + 2] += nz
      nrm[j] += nx; nrm[j + 1] += ny; nrm[j + 2] += nz
      nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz
      nx /= len; ny /= len; nz /= len
      // ∂area/∂p_a = ½ n̂ × (p_c − p_b), and cyclically.
      addCross(grad, i, nx, ny, nz, pos[k] - pos[j], pos[k + 1] - pos[j + 1], pos[k + 2] - pos[j + 2])
      addCross(grad, j, nx, ny, nz, pos[i] - pos[k], pos[i + 1] - pos[k + 1], pos[i + 2] - pos[k + 2])
      addCross(grad, k, nx, ny, nz, pos[j] - pos[i], pos[j + 1] - pos[i + 1], pos[j + 2] - pos[i + 2])
      // Normal stiffness of the area at each vertex: |opposite edge|² / (4 · triangle area).
      const inv = 1 / (2 * len)
      stiff[a] += sq(pos[k] - pos[j], pos[k + 1] - pos[j + 1], pos[k + 2] - pos[j + 2]) * inv
      stiff[b] += sq(pos[i] - pos[k], pos[i + 1] - pos[k + 1], pos[i + 2] - pos[k + 2]) * inv
      stiff[c] += sq(pos[j] - pos[i], pos[j + 1] - pos[i + 1], pos[j + 2] - pos[i + 2]) * inv
    }
    const { nbrStart, nbr } = this
    for (let v = 0; v < this.count; v++) {
      if (fixed[v]) continue
      const o = v * 3
      let nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2]
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (nl < 1e-14 || stiff[v] < 1e-14) continue
      nx /= nl; ny /= nl; nz /= nl
      const g = (grad[o] * nx + grad[o + 1] * ny + grad[o + 2] * nz) / stiff[v]
      let dx = -rate * g * nx, dy = -rate * g * ny, dz = -rate * g * nz
      if (smooth > 0) {
        let lx = 0, ly = 0, lz = 0
        const s = nbrStart[v], e = nbrStart[v + 1]
        for (let q = s; q < e; q++) {
          const w = nbr[q] * 3
          lx += pos[w]; ly += pos[w + 1]; lz += pos[w + 2]
        }
        const inv = 1 / (e - s)
        lx = lx * inv - pos[o]; ly = ly * inv - pos[o + 1]; lz = lz * inv - pos[o + 2]
        const ln = lx * nx + ly * ny + lz * nz
        dx += smooth * (lx - ln * nx); dy += smooth * (ly - ln * ny); dz += smooth * (lz - ln * nz)
      }
      pos[o] += dx; pos[o + 1] += dy; pos[o + 2] += dz
    }
  }

  run(pos: Float32Array, iterations: number, rate?: number, smooth?: number): void {
    for (let i = 0; i < iterations; i++) this.step(pos, rate, smooth)
  }
}

function sq(x: number, y: number, z: number): number { return x * x + y * y + z * z }

function addCross(g: Float64Array, o: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  g[o] += 0.5 * (ay * bz - az * by)
  g[o + 1] += 0.5 * (az * bx - ax * bz)
  g[o + 2] += 0.5 * (ax * by - ay * bx)
}
