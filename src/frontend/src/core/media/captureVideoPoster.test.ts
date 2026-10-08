/**
 * core/media/captureVideoPoster.test.ts
 * ---------------------------------------------------------------------------
 * `captureVideoPoster` against stubbed `<video>` / `<canvas>` elements (jsdom
 * cannot decode video): the happy path returns a JPEG poster blob plus the
 * video's natural size and duration, a wide frame is downscaled, an unreadable
 * or out-of-range video rejects, and the temporary object URL is always revoked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POSTER_MAX_WIDTH, captureVideoPoster } from './captureVideoPoster'

interface VideoSpec {
  duration: number
  videoWidth: number
  videoHeight: number
  /** Fire `onerror` instead of loading metadata. */
  fail?: boolean
}

let spec: VideoSpec = { duration: 4, videoWidth: 640, videoHeight: 360 }
let blobResult: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })
const drawImage = vi.fn()
const toBlobCalls: { type: string | undefined; quality: unknown }[] = []
let lastCanvas: FakeCanvas | undefined

class FakeVideo {
  preload = ''
  muted = false
  playsInline = false
  onloadedmetadata: (() => void) | null = null
  onseeked: (() => void) | null = null
  onerror: (() => void) | null = null
  duration = 0
  videoWidth = 0
  videoHeight = 0

  set currentTime(_seconds: number) {
    queueMicrotask(() => this.onseeked?.())
  }

  set src(_value: string) {
    queueMicrotask(() => {
      if (spec.fail) {
        this.onerror?.()
        return
      }
      this.duration = spec.duration
      this.videoWidth = spec.videoWidth
      this.videoHeight = spec.videoHeight
      this.onloadedmetadata?.()
    })
  }

  removeAttribute(): void {}
}

class FakeCanvas {
  width = 0
  height = 0

  getContext() {
    return { drawImage }
  }

  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: unknown): void {
    toBlobCalls.push({ type, quality })
    callback(blobResult)
  }
}

const realCreateElement = document.createElement.bind(document)
const createObjectURL = vi.fn(() => 'blob:temp-video')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  spec = { duration: 4, videoWidth: 640, videoHeight: 360 }
  blobResult = new Blob(['jpeg'], { type: 'image/jpeg' })
  toBlobCalls.length = 0
  lastCanvas = undefined
  drawImage.mockClear()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'video') return new FakeVideo()
    if (tag === 'canvas') {
      lastCanvas = new FakeCanvas()
      return lastCanvas
    }
    return realCreateElement(tag)
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

describe('captureVideoPoster', () => {
  it('returns a JPEG poster blob plus the video size and duration', async () => {
    const result = await captureVideoPoster(file)

    expect(result.poster).toBeInstanceOf(Blob)
    expect(result.width).toBe(640)
    expect(result.height).toBe(360)
    expect(result.durationSec).toBe(4)
    expect(toBlobCalls[0]?.type).toBe('image/jpeg')
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-video')
  })

  it('downscales a frame wider than the poster maximum but reports the video size', async () => {
    spec = { duration: 10, videoWidth: 3840, videoHeight: 2160 }

    const result = await captureVideoPoster(file)

    expect(lastCanvas?.width).toBe(POSTER_MAX_WIDTH)
    expect(lastCanvas?.height).toBe(720)
    expect(result.width).toBe(3840)
    expect(result.height).toBe(2160)
  })

  it('rejects a video the browser cannot decode, revoking the URL', async () => {
    spec = { duration: 0, videoWidth: 0, videoHeight: 0, fail: true }

    await expect(captureVideoPoster(file)).rejects.toThrow(/could not be read/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-video')
  })

  it.each([
    ['zero', 0],
    ['infinite', Number.POSITIVE_INFINITY],
    ['not-a-number', Number.NaN],
    ['over an hour', 3601],
  ])('rejects a %s duration', async (_label, duration) => {
    spec = { duration, videoWidth: 640, videoHeight: 360 }

    await expect(captureVideoPoster(file)).rejects.toThrow(/unsupported length/)
  })

  it('rejects when the frame has no size', async () => {
    spec = { duration: 4, videoWidth: 0, videoHeight: 0 }

    await expect(captureVideoPoster(file)).rejects.toThrow(/no readable size/)
  })

  it('rejects when the canvas cannot produce a blob', async () => {
    blobResult = null

    await expect(captureVideoPoster(file)).rejects.toThrow(/could not be captured/)
  })
})
