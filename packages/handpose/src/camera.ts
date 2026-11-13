// The webcam as a pinhole camera in source-video pixels, and how the canvas shows it. Camera space is
// three.js's (and WebGL's): x right, y up, looking down −z, metres. The selfie view mirrors x.
import { setVec3, vec3, type Vec3 } from './vec3.ts'

export class CameraModel {
  width = 1280
  height = 720
  /** Focal length in source pixels. */
  f = 1100
  mirror = true

  set(width: number, height: number, hfovDeg: number, mirror: boolean): void {
    this.width = width
    this.height = height
    this.f = width / 2 / Math.tan((hfovDeg * Math.PI) / 360)
    this.mirror = mirror
  }

  /** The point at depth 1 (z = −1) on the ray through source pixel (x, y). */
  ray<T extends Vec3 = Vec3>(x: number, y: number, out: T = vec3() as T): T {
    const dx = (x - this.width / 2) / this.f
    return setVec3(out, this.mirror ? -dx : dx, -(y - this.height / 2) / this.f, -1)
  }

  /** Canvas pixels per source pixel when the video covers a cw × ch canvas. */
  coverScale(cw: number, ch: number): number {
    return Math.max(cw / this.width, ch / this.height)
  }

  /**
   * For a cw × ch canvas showing the video cover-fitted: the vertical fov (degrees) of the matching
   * perspective camera, and the fraction of the video's width and height that is visible.
   */
  coverFit(cw: number, ch: number): { fovDeg: number; uvScale: [number, number] } {
    const s = this.coverScale(cw, ch)
    const fovDeg = (2 * Math.atan(ch / s / 2 / this.f) * 180) / Math.PI
    return { fovDeg, uvScale: [cw / s / this.width, ch / s / this.height] }
  }

  /** Source pixel → canvas pixel (cover-fitted, mirrored like the view). */
  toCanvas(x: number, y: number, cw: number, ch: number): [number, number] {
    const s = this.coverScale(cw, ch)
    const dx = (x - this.width / 2) * s
    return [cw / 2 + (this.mirror ? -dx : dx), ch / 2 + (y - this.height / 2) * s]
  }
}
