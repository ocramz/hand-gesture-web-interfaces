// The core shape: a ring through three fingertips of each hand, and the catenoid film between the rings.
// Pull the rings apart past the catenoid's stability limit and it pops: droplets, a flat disc on each
// ring, and a free bubble. Bring the discs close again and the catenoid re-forms. One hand alone holds a
// disc, like a bubble wand.
import { Group, Vector3 } from 'three'
import { ringNormal, TIP, type HandView } from '@ocramz/handpose'
import { neckRadius, solveCatenoid, type Catenoid } from '../geom/catenoid.ts'
import { discGrid, ringAxes, tubeGrid, writeCatenoid, writeDisc } from '../geom/grids.ts'
import { fitRing, newRing, type Ring } from '../geom/ring.ts'
import { FilmSurface } from '../render/filmSurface.ts'
import type { SharedFilmUniforms } from '../render/filmMaterial.ts'
import { Tube } from '../render/tube.ts'
import { smoothstep, tipMarker, wireMaterial, type Effects, type Shape, type ShapeParams } from './common.ts'

type State = 'none' | 'film' | 'popped'

const LIMITS = { minRadius: 0.012, maxRadius: 0.2 }
/** Pop at this fraction of the stability limit; re-form when the rings are this close (h / R). */
const POP_AT = 0.985
const REFORM_BELOW = 0.45
const HOLD = 0.4 // s a ring survives a bad fit

export class RingMode implements Shape {
  readonly group = new Group()
  state: State = 'none'
  /** h / hMax, for the status line. */
  stretch = 0
  readonly rings: [Ring, Ring] = [newRing(), newRing()]
  private readonly fit = newRing()
  private readonly ok: [boolean, boolean] = [false, false]
  private readonly lastFit: [number, number] = [-1e9, -1e9]
  private readonly seeded: [boolean, boolean] = [false, false]
  private readonly tube: FilmSurface
  private readonly discs: [FilmSurface, FilmSurface]
  private readonly wires: [Tube, Tube]
  private readonly tips = Array.from({ length: 6 }, () => tipMarker())
  private readonly cat: Catenoid = solveCatenoid(1, 1, 0.5)
  private readonly anchors = [new Vector3(), new Vector3()]

  constructor(shared: SharedFilmUniforms) {
    this.tube = new FilmSurface(tubeGrid(64, 33), shared)
    this.discs = [new FilmSurface(discGrid(64, 10), shared), new FilmSurface(discGrid(64, 10), shared)]
    this.wires = [new Tube(72, true, wireMaterial), new Tube(72, true, wireMaterial)]
    this.group.add(this.tube.mesh, ...this.discs.map(d => d.mesh), ...this.wires.map(w => w.mesh), ...this.tips)
  }

  get label(): string {
    if (this.state === 'film') return `film · stretch ${(this.stretch * 100).toFixed(0)}%`
    if (this.state === 'popped') return 'popped · bring the rings together'
    return this.ok[0] || this.ok[1] ? 'one ring' : 'no rings'
  }

  setEnabled(on: boolean): void {
    this.group.visible = on
    if (!on) this.state = 'none'
  }

  pokers(): Vector3[] {
    const out: Vector3[] = []
    for (let i = 0; i < 2; i++) if (this.ok[i]) out.push(...this.rings[i].tips)
    return out
  }

  update(dt: number, t: number, hands: readonly [HandView, HandView], p: ShapeParams, fx: Effects): void {
    const tipIdx = p.fingers.map(f => TIP[f])
    // Anchors: the three tips' centroid at the hand's depth.
    for (let i = 0; i < 2; i++) {
      const h = hands[i]
      if (!h.active) continue
      const a = this.anchors[i].set(0, 0, 0)
      for (const k of tipIdx) a.add(h.rays[k])
      a.multiplyScalar(h.depth / 3)
    }
    for (let i = 0; i < 2; i++) {
      const h = hands[i]
      if (!h.active) { this.ok[i] = false; this.seeded[i] = false; continue }
      const partner = hands[1 - i].active ? this.anchors[1 - i] : null
      const n = ringNormal(this.anchors[i], partner, p.tilt, 0.25, _n)
      const rays = [h.rays[tipIdx[0]], h.rays[tipIdx[1]], h.rays[tipIdx[2]]] as const
      if (fitRing(rays, this.anchors[i], n, LIMITS, this.fit)) {
        this.lastFit[i] = t
        this.blendRing(i, dt)
      }
      this.ok[i] = t - this.lastFit[i] < HOLD && this.seeded[i]
    }
    this.updateState(p, fx)
    this.draw(dt, p)
  }

  /** Eases the stored ring toward the new fit (the tips themselves are copied exactly). */
  private blendRing(i: number, dt: number): void {
    const r = this.rings[i]
    const f = this.fit
    for (let k = 0; k < 3; k++) r.tips[k].copy(f.tips[k])
    if (!this.seeded[i]) {
      r.center.copy(f.center); r.normal.copy(f.normal); r.radius = f.radius
      this.seeded[i] = true
    } else {
      const a = 1 - Math.exp(-dt / 0.05)
      r.center.lerp(f.center, a)
      r.normal.lerp(f.normal, a).normalize()
      r.radius += a * (f.radius - r.radius)
    }
    r.fallback = f.fallback
    r.valid = true
  }

  private updateState(p: ShapeParams, fx: Effects): void {
    if (!(this.ok[0] && this.ok[1])) {
      this.state = 'none'
      this.stretch = 0
      return
    }
    const [r1, r2] = this.rings
    const h = r1.center.distanceTo(r2.center)
    solveCatenoid(r1.radius, r2.radius, h, this.cat)
    this.stretch = h / this.cat.hMax
    const meanR = (r1.radius + r2.radius) / 2
    if (this.state === 'none') {
      this.state = this.stretch < 0.95 || !p.pop ? 'film' : 'popped'
      this.tube.resetRelaxation()
    } else if (this.state === 'film' && p.pop && this.stretch >= POP_AT) {
      this.pop(fx)
    } else if (this.state === 'popped' && (h / meanR < REFORM_BELOW || !p.pop)) {
      this.state = 'film'
      this.tube.resetRelaxation()
      this.tube.fade = 0.3
    }
  }

  private pop(fx: Effects): void {
    const [r1, r2] = this.rings
    const c = this.cat
    const z = Math.min(c.h, Math.max(0, c.z0))
    const axis = _a.subVectors(r2.center, r1.center).normalize()
    const neck = _p.copy(r1.center).addScaledVector(axis, z)
    const nr = neckRadius(c)
    ringAxes(r1, r2, _axes)
    fx.droplets.burstRing(neck, _axes.e1a, _axes.e2a, nr, 220, 0.8)
    fx.droplets.burstRing(r1.center, _axes.e1a, _axes.e2a, r1.radius, 50, 0.3)
    fx.droplets.burstRing(r2.center, _axes.e1b, _axes.e2b, r2.radius, 50, 0.3)
    const vel = _v.set((Math.random() - 0.5) * 0.04, 0.05 + Math.random() * 0.03, (Math.random() - 0.5) * 0.02)
    fx.bubbles.spawn(neck, Math.max(0.012, 0.75 * nr), vel)
    this.state = 'popped'
    this.tube.fade = 0
    for (const d of this.discs) d.fade = 0
  }

  private draw(dt: number, p: ShapeParams): void {
    const film = this.state === 'film'
    const [r1, r2] = this.rings
    // Tube.
    this.tube.setFadeTarget(film ? 1 : 0)
    if (film) {
      const cat = this.cat
      // Without popping, hold the profile at the limit however far the rings go.
      if (!cat.exists) solveCatenoid(r1.radius, r2.radius, cat.hMax * 0.999, cat)
      writeCatenoid(this.tube.grid, r1, r2, cat)
      if (p.relax) this.tube.relax(p.relaxIterations)
      this.tube.commit()
      this.tube.material.uniforms.uThin.value = smoothstep(0.8, POP_AT, this.stretch)
    }
    this.tube.updateFade(dt, film ? 3 : 8)
    // Discs: a lone ring, or both after a pop.
    for (let i = 0; i < 2; i++) {
      const d = this.discs[i]
      const show = this.ok[i] && !film
      d.setFadeTarget(show ? 1 : 0)
      if (this.ok[i]) {
        writeDisc(d.grid, this.rings[i])
        d.commit()
      }
      d.updateFade(dt, show ? 2.5 : 6)
    }
    // Wires and fingertips.
    for (let i = 0; i < 2; i++) {
      const w = this.wires[i]
      w.mesh.visible = this.ok[i]
      const r = this.rings[i]
      if (this.ok[i]) {
        _e1.set(0, 1, 0).addScaledVector(r.normal, -r.normal.y)
        if (_e1.lengthSq() < 1e-6) _e1.set(1, 0, 0).addScaledVector(r.normal, -r.normal.x)
        _e1.normalize()
        _e2.crossVectors(r.normal, _e1)
        const n = w.points.length
        for (let k = 0; k < n; k++) {
          const th = (2 * Math.PI * k) / n
          w.points[k].copy(r.center).addScaledVector(_e1, r.radius * Math.cos(th)).addScaledVector(_e2, r.radius * Math.sin(th))
        }
        w.update(0.0011)
      }
      for (let k = 0; k < 3; k++) {
        const m = this.tips[i * 3 + k]
        m.visible = this.ok[i]
        if (this.ok[i]) m.position.copy(r.tips[k])
      }
    }
  }
}

const _n = new Vector3()
const _a = new Vector3()
const _p = new Vector3()
const _v = new Vector3()
const _e1 = new Vector3()
const _e2 = new Vector3()
const _axes = { e1a: new Vector3(), e2a: new Vector3(), na: new Vector3(), e1b: new Vector3(), e2b: new Vector3(), nb: new Vector3() }
