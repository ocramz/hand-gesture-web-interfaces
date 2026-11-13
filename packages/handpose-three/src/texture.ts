// A FrameSource's frames as a three.js texture: a VideoTexture for the webcam, a plain Texture for a still image.
import { SRGBColorSpace, Texture, VideoTexture } from 'three'
import type { FrameSource } from '@ocramz/handpose'

export function sourceTexture(source: FrameSource): Texture {
  const el = source.element
  if (el instanceof HTMLVideoElement) {
    const video = new VideoTexture(el)
    video.colorSpace = SRGBColorSpace
    return video
  }
  const still = new Texture(el)
  still.colorSpace = SRGBColorSpace
  still.needsUpdate = true
  return still
}
