// Where frames come from: the webcam, or a still image (?image=/samples/two_hands.jpg) for testing.
import { SRGBColorSpace, Texture, VideoTexture } from 'three'

export interface FrameSource {
  kind: 'webcam' | 'image'
  element: HTMLVideoElement | HTMLImageElement
  width: number
  height: number
  texture: Texture
  /** True when a frame the model hasn't seen is available. */
  hasNewFrame(now: number): boolean
  /** The current frame, downscaled so its long side is at most `maxSide`. */
  grab(maxSide: number): Promise<ImageBitmap>
}

function grabber(el: HTMLVideoElement | HTMLImageElement, width: number, height: number) {
  return (maxSide: number) => {
    const k = Math.min(1, maxSide / Math.max(width, height))
    return createImageBitmap(el, { resizeWidth: Math.round(width * k), resizeHeight: Math.round(height * k), resizeQuality: 'medium' })
  }
}

export async function openWebcam(): Promise<FrameSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  })
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }))
  const texture = new VideoTexture(video)
  texture.colorSpace = SRGBColorSpace
  let lastTime = -1
  return {
    kind: 'webcam',
    element: video,
    width: video.videoWidth,
    height: video.videoHeight,
    texture,
    hasNewFrame() {
      if (video.readyState < 2 || video.currentTime === lastTime) return false
      lastTime = video.currentTime
      return true
    },
    grab: grabber(video, video.videoWidth, video.videoHeight),
  }
}

export async function openImage(url: string): Promise<FrameSource> {
  const img = new Image()
  img.src = url
  await img.decode()
  const texture = new Texture(img)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  let last = -1e9
  return {
    kind: 'image',
    element: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    texture,
    // A still image: re-run the model a few times a second so the whole pipeline stays live.
    hasNewFrame(now) {
      if (now - last < 0.12) return false
      last = now
      return true
    },
    grab: grabber(img, img.naturalWidth, img.naturalHeight),
  }
}
