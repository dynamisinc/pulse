/**
 * core/media/captureVideoPoster.test.ts
 * ---------------------------------------------------------------------------
 * `captureVideoPoster` against stubbed `<video>` / `<canvas>` elements (jsdom
 * cannot decode video): the happy path returns a JPEG poster blob plus the
 * video's natural size and duration; a wide frame is downscaled, and the POSTER's
 * own size (`posterWidth`/`posterHeight`, what the poster upload must send) is
 * reported separately from the video's; an unreadable or out-of-range video
 * rejects, and the temporary object URL is always revoked.
 *
 * NEVER HANGS (fake timers): a video that fires neither `loadedmetadata` nor
 * `error` rejects after the capture timeout, so `uploadVideoWithPoster` falls
 * back to a poster-less upload; an `AbortSignal` rejects with an `AbortError`;
 * and on success, error, timeout or abort the element's source is detached and
 * the object URL revoked exactly once, with no timer left running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbortError } from './mediaErrors'
import {
  POSTER_CAPTURE_TIMEOUT_MS,
  POSTER_MAX_WIDTH,
  captureVideoPoster,
} from './captureVideoPoster'

interface VideoSpec {
  duration: number
  videoWidth: number
  videoHeight: number
  /** Fire `onerror` instead of loading metadata. */
  fail?: boolean
  /** Fire NOTHING — a file the browser neither decodes nor rejects. */
  hang?: boolean
}

let spec: VideoSpec = { duration: 4, videoWidth: 640, videoHeight: 360 }
let blobResult: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' })
const drawImage = vi.fn()
const toBlobCalls: { type: string | undefined; quality: unknown }[] = []
let lastCanvas: FakeCanvas | undefined
let lastVideo: FakeVideo | undefined
const loadCalls = vi.fn()
const removedAttributes: string[] = []

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
    if (spec.hang) return
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

  removeAttribute(name: string): void {
    removedAttributes.push(name)
  }

  load(): void {
    loadCalls()
  }
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
  lastVideo = undefined
  loadCalls.mockClear()
  removedAttributes.length = 0
  drawImage.mockClear()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'video') {
      lastVideo = new FakeVideo()
      return lastVideo
    }
    if (tag === 'canvas') {
      lastCanvas = new FakeCanvas()
      return lastCanvas
    }
    return realCreateElement(tag)
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

describe('captureVideoPoster', () => {
  it('returns a JPEG poster blob plus the video size and duration', async () => {
    const result = await captureVideoPoster(file)

    expect(result.poster).toBeInstanceOf(Blob)
    expect(result.width).toBe(640)
    expect(result.height).toBe(360)
    // Not wider than the poster maximum, so the poster is the video's size.
    expect(result.posterWidth).toBe(640)
    expect(result.posterHeight).toBe(360)
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

  it('reports the downscaled POSTER size separately from the video size (the canvas it drew)', async () => {
    spec = { duration: 10, videoWidth: 3840, videoHeight: 2160 }

    const result = await captureVideoPoster(file)

    expect(result.posterWidth).toBe(POSTER_MAX_WIDTH)
    expect(result.posterHeight).toBe(720)
    expect(result.posterWidth).toBe(lastCanvas?.width)
    expect(result.posterHeight).toBe(lastCanvas?.height)
    // The video's own size is untouched.
    expect(result.width).toBe(3840)
    expect(result.height).toBe(2160)
  })

  it('rounds the downscaled poster height to a whole pixel', async () => {
    spec = { duration: 10, videoWidth: 2000, videoHeight: 1001 }

    const result = await captureVideoPoster(file)

    // 1280 / 2000 = 0.64; 1001 * 0.64 = 640.64 -> 641.
    expect(result.posterWidth).toBe(POSTER_MAX_WIDTH)
    expect(result.posterHeight).toBe(641)
    expect(Number.isInteger(result.posterHeight)).toBe(true)
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

describe('captureVideoPoster — never hangs', () => {
  it('rejects after the capture timeout when the video fires neither loaded nor error', async () => {
    vi.useFakeTimers()
    spec = { duration: 4, videoWidth: 640, videoHeight: 360, hang: true }

    const result = captureVideoPoster(file).catch((error: unknown) => error)
    // Still pending a moment before the deadline...
    await vi.advanceTimersByTimeAsync(POSTER_CAPTURE_TIMEOUT_MS - 1)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    // ...and rejected exactly at it.
    await vi.advanceTimersByTimeAsync(1)

    const error = await result
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/took too long/)
    expect(isAbortError(error)).toBe(false)
  })

  it('releases the element source and the object URL on timeout', async () => {
    vi.useFakeTimers()
    spec = { duration: 4, videoWidth: 640, videoHeight: 360, hang: true }

    const result = captureVideoPoster(file).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(POSTER_CAPTURE_TIMEOUT_MS)
    await result

    expect(removedAttributes).toEqual(['src'])
    expect(loadCalls).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-video')
    expect(lastVideo?.onloadedmetadata).toBeNull()
  })

  it('honours a custom timeout', async () => {
    vi.useFakeTimers()
    spec = { duration: 4, videoWidth: 640, videoHeight: 360, hang: true }

    const result = captureVideoPoster(file, { timeoutMs: 250 }).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(250)

    expect(((await result) as Error).message).toMatch(/took too long/)
  })

  it('leaves no timer running after a successful capture', async () => {
    vi.useFakeTimers()

    await captureVideoPoster(file)

    expect(vi.getTimerCount()).toBe(0)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('rejects with an AbortError and releases everything when aborted mid-capture', async () => {
    vi.useFakeTimers()
    spec = { duration: 4, videoWidth: 640, videoHeight: 360, hang: true }
    const controller = new AbortController()

    const result = captureVideoPoster(file, { signal: controller.signal }).catch(
      (error: unknown) => error,
    )
    controller.abort()

    expect(isAbortError(await result)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(removedAttributes).toEqual(['src'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects immediately, creating no element or object URL, when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(captureVideoPoster(file, { signal: controller.signal })).rejects.toSatisfy(
      isAbortError,
    )
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(lastVideo).toBeUndefined()
  })

  it('an abort AFTER success changes nothing (the listener is removed, URL revoked once)', async () => {
    const controller = new AbortController()

    const result = await captureVideoPoster(file, { signal: controller.signal })
    controller.abort()

    expect(result.durationSec).toBe(4)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('still settles when tearing the element down throws', async () => {
    vi.useFakeTimers()
    spec = { duration: 4, videoWidth: 640, videoHeight: 360, hang: true }
    const result = captureVideoPoster(file).catch((error: unknown) => error)
    if (lastVideo === undefined) throw new Error('no video element')
    lastVideo.load = () => {
      throw new Error('load blew up')
    }

    await vi.advanceTimersByTimeAsync(POSTER_CAPTURE_TIMEOUT_MS)

    expect(((await result) as Error).message).toMatch(/took too long/)
  })
})
