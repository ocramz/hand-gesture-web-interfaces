// The demo's debug overlay: the model's raw detections as boxes with their confidence, in canvas pixels.
// (drawDebug in @ocramz/handpose draws these too, plus the skeletons and the tracked keypoints.)
import type { CameraModel, Hand } from '@ocramz/handpose'

/** Clears the overlay, then draws each detection's box and confidence. An empty `raw` just clears it. */
export function drawBoxes(ctx: CanvasRenderingContext2D, cam: CameraModel, raw: readonly Hand[], dpr: number): void {
  const cw = ctx.canvas.width / dpr
  const ch = ctx.canvas.height / dpr
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.lineWidth = 1.5
  ctx.font = '12px ui-monospace, monospace'
  ctx.strokeStyle = 'rgba(255, 90, 90, 0.8)'
  ctx.fillStyle = 'rgba(255, 90, 90, 0.95)'
  for (const h of raw) {
    const [x1, y1] = cam.toCanvas(h.box[0], h.box[1], cw, ch)
    const [x2, y2] = cam.toCanvas(h.box[2], h.box[3], cw, ch)
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    ctx.strokeRect(x, y, Math.abs(x2 - x1), Math.abs(y2 - y1))
    ctx.fillText(h.conf.toFixed(2), x + 3, y + 13)
  }
  ctx.restore()
}
