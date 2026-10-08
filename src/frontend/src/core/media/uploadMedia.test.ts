/**
 * core/media/uploadMedia.test.ts
 * ---------------------------------------------------------------------------
 * The MOCK upload adapter (`USE_MOCK_DATA` is true under Vitest; demo-polish F0,
 * implementation.md §5): `validateMediaFile` first (same text as the server's
 * 413/415), then >= 4 abortable simulated progress ticks, then an object URL is
 * minted and the asset registered in the in-memory mock registry.
 *
 * Also the composite flows: `uploadVideoWithPoster` (poster FIRST, then the video
 * carrying `posterMediaId`; falls back to a poster-less video when the browser
 * cannot decode it) and the composer entry point `uploadPickedMedia` (image: size
 * hint then upload; video: the poster flow).
 *
 * Timers are faked so the simulated progress is stepped deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { isAbortError, MEDIA_ERROR_TEXT, MediaUploadError } from './mediaErrors'
import { getMockMediaAsset, listMockMedia, resetMockMediaRegistry } from './mockMediaRegistry'

const captureMock = vi.hoisted(() => vi.fn())
const readSizeMock = vi.hoisted(() => vi.fn())

vi.mock('./captureVideoPoster', () => ({ captureVideoPoster: captureMock }))
vi.mock('./readImageSize', () => ({ readImageSize: readSizeMock }))

import {
  MOCK_PROGRESS_TICKS,
  MOCK_TICK_MS,
  uploadMedia,
  uploadPickedMedia,
  uploadVideoWithPoster,
} from './uploadMedia'

const TOTAL_MS = MOCK_PROGRESS_TICKS * MOCK_TICK_MS

let objectUrlCounter = 0
const createObjectURL = vi.fn((_blob: Blob) => `blob:mock-${(objectUrlCounter += 1)}`)

function imageFile(name = 'flood.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

function videoFile(name = 'briefing.mp4'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'video/mp4' })
}

beforeEach(() => {
  vi.useFakeTimers()
  objectUrlCounter = 0
  createObjectURL.mockClear()
  captureMock.mockReset()
  readSizeMock.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T16:00:00.000Z') })
})

afterEach(() => {
  vi.useRealTimers()
  resetExerciseClock()
  resetMockMediaRegistry()
})

describe('uploadMedia (mock adapter) — result', () => {
  it('resolves a MediaAssetView with an object URL and registers it', async () => {
    const promise = uploadMedia(imageFile(), { width: 1600, height: 900 })
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const asset = await promise

    expect(asset.id).toMatch(/^mock-media-/)
    expect(asset).toMatchObject({ kind: 'image', url: 'blob:mock-1', width: 1600, height: 900 })
    expect(asset).not.toHaveProperty('posterUrl')

    const registered = getMockMediaAsset(asset.id)
    expect(registered).toMatchObject({
      url: 'blob:mock-1',
      fileName: 'flood.png',
      // Stamped from the EXERCISE clock (COR-053), never the wall clock.
      uploadedAtScenario: '2033-09-04T16:00:00.000Z',
    })
    expect(listMockMedia()[0]?.id).toBe(asset.id)
  })

  it('gives a video its duration and keeps the file name in the library row', async () => {
    const promise = uploadMedia(videoFile('clip.mp4'), { durationSec: 12, width: 640, height: 360 })
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const asset = await promise

    expect(asset).toMatchObject({ kind: 'video', durationSec: 12, width: 640, height: 360 })
    expect(getMockMediaAsset(asset.id)?.fileName).toBe('clip.mp4')
  })

  it('mints a distinct id and URL per upload', async () => {
    const first = uploadMedia(imageFile('a.png'))
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const second = uploadMedia(imageFile('b.png'))
    await vi.advanceTimersByTimeAsync(TOTAL_MS)

    const [a, b] = [await first, await second]
    expect(a.id).not.toBe(b.id)
    expect(a.url).not.toBe(b.url)
  })

  it('never puts an exerciseId (or any scope) on the returned asset', async () => {
    const promise = uploadMedia(imageFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS)

    expect(JSON.stringify(await promise)).not.toMatch(/exercise/i)
  })
})

describe('uploadMedia (mock adapter) — progress', () => {
  it('reports at least 4 ticks, strictly increasing, ending at exactly 1', async () => {
    expect(MOCK_PROGRESS_TICKS).toBeGreaterThanOrEqual(4)
    const seen: number[] = []

    const promise = uploadMedia(imageFile(), { onProgress: f => seen.push(f) })
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    await promise

    expect(seen.length).toBeGreaterThanOrEqual(4)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.every(f => f >= 0 && f <= 1)).toBe(true)
    expect(seen.at(-1)).toBe(1)
  })
})

describe('uploadMedia (mock adapter) — abort', () => {
  it('rejects with an AbortError and registers nothing when aborted mid-flight', async () => {
    const controller = new AbortController()
    const before = listMockMedia().length

    const promise = uploadMedia(imageFile(), { signal: controller.signal })
    const settled = promise.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(MOCK_TICK_MS * 2)
    controller.abort()
    const error = await settled

    expect(isAbortError(error)).toBe(true)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(listMockMedia()).toHaveLength(before)
    // No tick fires after the abort.
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
  })

  it('rejects immediately, without any progress, when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const onProgress = vi.fn()

    await expect(
      uploadMedia(imageFile(), { signal: controller.signal, onProgress }),
    ).rejects.toSatisfy(isAbortError)
    expect(onProgress).not.toHaveBeenCalled()
  })
})

describe('uploadMedia (mock adapter) — validation uses the server-mapped text', () => {
  it('rejects an unsupported type with the 415 text and no object URL', async () => {
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' })

    const error = await uploadMedia(file).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MediaUploadError)
    expect((error as Error).message).toBe(MEDIA_ERROR_TEXT.unsupported)
    expect((error as Error).message).toContain('MP4 (H.264)')
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects an oversize image with the 413 text', async () => {
    const file = imageFile()
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 })

    await expect(uploadMedia(file)).rejects.toThrow(MEDIA_ERROR_TEXT.tooLargeImage)
  })
})

describe('uploadMedia (mock adapter) — a video poster', () => {
  it('links posterUrl from the poster asset and hides the poster from the library', async () => {
    const posterPromise = uploadMedia(imageFile('poster.jpg'))
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const poster = await posterPromise

    const videoPromise = uploadMedia(videoFile(), { posterMediaId: poster.id })
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const video = await videoPromise

    expect(video.posterUrl).toBe(poster.url)
    expect(listMockMedia().some(item => item.id === poster.id)).toBe(false)
    expect(listMockMedia().some(item => item.id === video.id)).toBe(true)
  })
})

describe('uploadVideoWithPoster — poster first, then the video with posterMediaId', () => {
  const captured = {
    poster: new Blob(['jpeg'], { type: 'image/jpeg' }),
    width: 640,
    height: 360,
    posterWidth: 640,
    posterHeight: 360,
    durationSec: 4,
  }

  it('uploads the poster image first and the video carrying that poster', async () => {
    captureMock.mockResolvedValue(captured)

    const promise = uploadVideoWithPoster(videoFile('briefing.mp4'))
    await vi.advanceTimersByTimeAsync(TOTAL_MS * 2)
    const video = await promise

    // First object URL = the poster, second = the video.
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    const posterFile = createObjectURL.mock.calls[0]?.[0] as File
    expect(posterFile.name).toBe('briefing.poster.jpg')
    expect(posterFile.type).toBe('image/jpeg')

    expect(video).toMatchObject({
      kind: 'video',
      url: 'blob:mock-2',
      posterUrl: 'blob:mock-1',
      width: 640,
      height: 360,
      durationSec: 4,
    })
    // The poster is a registered image, hidden from the library; the video is listed.
    expect(listMockMedia('image').some(item => item.url === 'blob:mock-1')).toBe(false)
    expect(listMockMedia('video').some(item => item.id === video.id)).toBe(true)
  })

  it('gives the video the SOURCE size and duration when the poster was downscaled', async () => {
    captureMock.mockResolvedValue({
      ...captured,
      width: 3840,
      height: 2160,
      posterWidth: 1280,
      posterHeight: 720,
      durationSec: 12.5,
    })

    const promise = uploadVideoWithPoster(videoFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS * 2)

    expect(await promise).toMatchObject({
      kind: 'video',
      width: 3840,
      height: 2160,
      durationSec: 12.5,
    })
  })

  it('reports monotonic progress across both uploads, ending at 1', async () => {
    captureMock.mockResolvedValue(captured)
    const seen: number[] = []

    const promise = uploadVideoWithPoster(videoFile(), { onProgress: f => seen.push(f) })
    await vi.advanceTimersByTimeAsync(TOTAL_MS * 2)
    await promise

    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(1)
    expect(seen.length).toBeGreaterThan(MOCK_PROGRESS_TICKS)
  })

  it('hands the abort signal to the poster capture (it can be cancelled, not just time out)', async () => {
    captureMock.mockResolvedValue(captured)
    const controller = new AbortController()

    const promise = uploadVideoWithPoster(videoFile(), { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(TOTAL_MS * 2)
    await promise

    expect(captureMock).toHaveBeenCalledWith(expect.any(File), { signal: controller.signal })
  })

  it('uploads the video on its own when the browser cannot capture a poster', async () => {
    captureMock.mockRejectedValue(new Error('cannot decode'))

    const promise = uploadVideoWithPoster(videoFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const video = await promise

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(video.kind).toBe('video')
    expect(video).not.toHaveProperty('posterUrl')
  })

  it('falls back to a poster-less video when the capture times out (never hangs the flow)', async () => {
    captureMock.mockRejectedValue(new Error('That video took too long to read.'))

    const promise = uploadVideoWithPoster(videoFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const video = await promise

    expect(video.kind).toBe('video')
    expect(video).not.toHaveProperty('posterUrl')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-video file', async () => {
    await expect(uploadVideoWithPoster(imageFile())).rejects.toBeInstanceOf(MediaUploadError)
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('rejects with an AbortError when cancelled during the poster capture', async () => {
    const controller = new AbortController()
    captureMock.mockImplementation(async () => {
      controller.abort()
      return captured
    })

    await expect(
      uploadVideoWithPoster(videoFile(), { signal: controller.signal }),
    ).rejects.toSatisfy(isAbortError)
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

describe('uploadPickedMedia — the composer entry point', () => {
  it('reads an image size first and sends it as the width/height hint', async () => {
    readSizeMock.mockResolvedValue({ width: 1200, height: 800 })

    const promise = uploadPickedMedia(imageFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS)

    expect(await promise).toMatchObject({ kind: 'image', width: 1200, height: 800 })
  })

  it('hands the upload abort signal to the image size read', async () => {
    readSizeMock.mockResolvedValue({ width: 1200, height: 800 })
    const controller = new AbortController()
    const file = imageFile()

    const promise = uploadPickedMedia(file, { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    await promise

    expect(readSizeMock).toHaveBeenCalledWith(file, { signal: controller.signal })
  })

  it('passes no signal option to the size read when the upload has none', async () => {
    readSizeMock.mockResolvedValue({ width: 1200, height: 800 })
    const file = imageFile()

    const promise = uploadPickedMedia(file)
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    await promise

    expect(readSizeMock).toHaveBeenCalledWith(file, {})
  })

  it('rejects with an AbortError and uploads nothing when cancelled during the size read', async () => {
    const controller = new AbortController()
    readSizeMock.mockImplementation(async () => {
      controller.abort()
      throw new DOMException('The upload was cancelled.', 'AbortError')
    })

    await expect(uploadPickedMedia(imageFile(), { signal: controller.signal })).rejects.toSatisfy(
      isAbortError,
    )
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(listMockMedia().some(item => item.fileName === 'flood.png')).toBe(false)
  })

  it('still uploads an image whose size could not be read', async () => {
    readSizeMock.mockRejectedValue(new Error('undecodable'))

    const promise = uploadPickedMedia(imageFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS)
    const asset = await promise

    expect(asset.kind).toBe('image')
    expect(asset).not.toHaveProperty('width')
  })

  it('routes a video through the poster flow', async () => {
    captureMock.mockResolvedValue({
      poster: new Blob(['jpeg'], { type: 'image/jpeg' }),
      width: 640,
      height: 360,
      posterWidth: 640,
      posterHeight: 360,
      durationSec: 4,
    })

    const promise = uploadPickedMedia(videoFile())
    await vi.advanceTimersByTimeAsync(TOTAL_MS * 2)
    const asset = await promise

    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(asset.posterUrl).toBe('blob:mock-1')
  })

  it('rejects an invalid file with the validation text before doing anything', async () => {
    const file = new File(['x'], 'a.bmp', { type: 'image/bmp' })

    await expect(uploadPickedMedia(file)).rejects.toThrow(MEDIA_ERROR_TEXT.unsupported)
    expect(readSizeMock).not.toHaveBeenCalled()
  })
})
