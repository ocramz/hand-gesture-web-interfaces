// 2D overlay: raw detections (boxes, skeletons, confidence) and the tracked hands, in canvas pixels.
import type { CameraModel } from '../camera.ts'
import type { HandView } from '../hands.ts'
import { SKELETON, TIP, type Hand } from '../pose/types.ts'

export function drawDebug(ctx: CanvasRenderingContext2D, cam: CameraModel, raw: readonly Hand[], views: readonly HandView[], dpr: number): void {
  const cw = ctx.canvas.width / dpr
  const ch = ctx.canvas.height / dpr
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const at = (x: number, y: number) => cam.toCanvas(x, y, cw, ch)
  ctx.lineWidth = 1.5
  ctx.font = '12px ui-monospace, monospace'
  for (const h of raw) {
    const [x1, y1] = at(h.box[0], h.box[1])
    const [x2, y2] = at(h.box[2], h.box[3])
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.8)'
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
    ctx.fillStyle = 'rgba(255, 90, 90, 0.95)'
    ctx.fillText(h.conf.toFixed(2), Math.min(x1, x2) + 3, Math.min(y1, y2) + 13)
    ctx.beginPath()
    for (const [a, b] of SKELETON) {
      const [ax, ay] = at(h.kp[3 * a], h.kp[3 * a + 1])
      const [bx, by] = at(h.kp[3 * b], h.kp[3 * b + 1])
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
    }
    ctx.stroke()
  }
  const tipSet = new Set(Object.values(TIP))
  views.forEach((v, i) => {
    if (!v.active) return
    ctx.fillStyle = i === 0 ? 'rgba(90, 220, 255, 0.95)' : 'rgba(150, 255, 140, 0.95)'
    for (let k = 0; k < 21; k++) {
      const [x, y] = at(v.kp[3 * k], v.kp[3 * k + 1])
      ctx.beginPath()
      ctx.arc(x, y, tipSet.has(k) ? 4 : 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    const [wx, wy] = at(v.kp[0], v.kp[1])
    ctx.fillText(`${i === 0 ? 'L' : 'R'} ${(v.depth * 100).toFixed(0)} cm`, wx + 6, wy + 16)
  })
  ctx.restore()
}

export function clearOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}
