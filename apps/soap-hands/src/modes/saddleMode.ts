// Twisted saddle: thumb tip → index tip on each hand is a wire; the film spans the skew quadrilateral
// the two wires make, its free edges bowing inward. Twist the hands against each other and the film
// becomes a helicoid-like saddle.
import { Group, Vector3 } from 'three'
import { KP, raysOnPlane, ringNormal, type HandView } from '@ocramz/handpose'
import { patchGrid, writeCoons, type Curve } from '../geom/grids.ts'
import { FilmSurface } from '../render/filmSurface.ts'
import type { SharedFilmUniforms } from '../render/filmMaterial.ts'
import { Tube } from '../render/tube.ts'
import { tipMarker, wireMaterial, type Effects, type Shape, type ShapeParams } from './common.ts'

const EDGE_POINTS = 32

export class SaddleMode implements Shape {
  readonly group = new Group()
  private readonly film: FilmSurface
  /** Per hand: [thumb tip, index tip] in 3D. */
  private readonly pts = [[new Vector3(), new Vector3()], [new Vector3(), new Vector3()]] as const
  private readonly ok: [boolean, boolean] = [false, false]
  private readonly wires: [Tube, Tube]
  private readonly edges: [Tube, Tube]
  private readonly tips = Array.from({ length: 4 }, () => tipMarker())
  private readonly anchors = [new Vector3(), new Vector3()]
  private twist = 0

  constructor(shared: SharedFilmUniforms) {
    this.film = new FilmSurface(patchGrid(40, 22), shared)
    this.wires = [new Tube(2, false, wireMaterial), new Tube(2, false, wireMaterial)]
    this.edges = [new Tube(EDGE_POINTS, false, wireMaterial), new Tube(EDGE_POINTS, false, wireMaterial)]
    for (const e of this.edges) e.mesh.renderOrder = 1
    this.group.add(this.film.mesh, ...this.wires.map(w => w.mesh), ...this.edges.map(e => e.mesh), ...this.tips)
  }

  get label(): string {
    if (this.ok[0] && this.ok[1]) return `saddle · twist ${this.twist.toFixed(0)}°`
    return 'saddle · show both hands'
  }

  setEnabled(on: boolean): void { this.group.visible = on }

  pokers(): Vector3[] {
    const out: Vector3[] = []
    for (let i = 0; i < 2; i++) if (this.ok[i]) out.push(...this.pts[i])
    return out
  }

  update(dt: number, _t: number, hands: readonly [HandView, HandView], p: ShapeParams, _fx: Effects): void {
    for (let i = 0; i < 2; i++) {
      const h = hands[i]
      if (!h.active) continue
      this.anchors[i].copy(h.rays[KP.thumbTip]).add(h.rays[KP.indexTip]).multiplyScalar(h.depth / 2)
    }
    for (let i = 0; i < 2; i++) {
      const h = hands[i]
      this.ok[i] = false
      if (!h.active) continue
      const n = ringNormal(this.anchors[i], hands[1 - i].active ? this.anchors[1 - i] : null, p.tilt, 0.25, _n)
      this.ok[i] = raysOnPlane([h.rays[KP.thumbTip], h.rays[KP.indexTip]], this.anchors[i], n, this.pts[i])
    }
    const both = this.ok[0] && this.ok[1]
    this.film.setFadeTarget(both ? 1 : 0)
    if (both) this.buildFilm(p)
    else this.film.resetRelaxation()
    this.film.updateFade(dt, both ? 3 : 6)
    for (let i = 0; i < 2; i++) {
      const w = this.wires[i]
      w.mesh.visible = this.ok[i]
      if (this.ok[i]) {
        w.points[0].copy(this.pts[i][0])
        w.points[1].copy(this.pts[i][1])
        w.update(0.0013)
      }
      this.edges[i].mesh.visible = both
      for (let k = 0; k < 2; k++) {
        const m = this.tips[i * 2 + k]
        m.visible = this.ok[i]
        if (this.ok[i]) m.position.copy(this.pts[i][k])
      }
    }
  }

  private buildFilm(p: ShapeParams): void {
    const [[Lt, Li], [Rt, Ri]] = this.pts
    // The twist: angle between the two wires seen along the line joining the hands.
    const axis = _a.addVectors(Rt, Ri).sub(Lt).sub(Li).normalize()
    const wl = _b.subVectors(Li, Lt)
    wl.addScaledVector(axis, -wl.dot(axis))
    const wr = _c.subVectors(Ri, Rt)
    wr.addScaledVector(axis, -wr.dot(axis))
    if (wl.lengthSq() > 1e-10 && wr.lengthSq() > 1e-10) {
      const ang = Math.acos(Math.max(-1, Math.min(1, wl.normalize().dot(wr.normalize()))))
      this.twist = (ang * 180) / Math.PI
    }
    const centre = _m.copy(Lt).add(Li).add(Rt).add(Ri).multiplyScalar(0.25)
    const sag = p.sag
    // A free edge: quadratic Bézier from a to b whose control point is pulled toward the centre.
    const bowed = (a: Vector3, b: Vector3, ctrl: Vector3): Curve => {
      ctrl.addVectors(a, b).multiplyScalar(0.5)
      ctrl.lerp(centre, Math.min(0.9, 2 * sag))
      return (t, out) => {
        const u = 1 - t
        return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(ctrl, 2 * u * t).addScaledVector(b, t * t)
      }
    }
    const left: Curve = (v, out) => out.lerpVectors(Lt, Li, v)
    const right: Curve = (v, out) => out.lerpVectors(Rt, Ri, v)
    const bottom = bowed(Lt, Rt, _cb)
    const top = bowed(Li, Ri, _ct)
    writeCoons(this.film.grid, left, right, bottom, top)
    if (p.relax) this.film.relax(p.relaxIterations)
    this.film.commit()
    this.film.material.uniforms.uThin.value = 0
    for (const [tube, curve] of [[this.edges[0], bottom], [this.edges[1], top]] as const) {
      for (let k = 0; k < EDGE_POINTS; k++) curve(k / (EDGE_POINTS - 1), tube.points[k])
      tube.update(0.0006)
    }
  }
}

const _n = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _m = new Vector3()
const _cb = new Vector3()
const _ct = new Vector3()
