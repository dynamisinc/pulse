/**
 * core/media/uploadMedia.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE upload adapter (`USE_MOCK_DATA` forced false; demo-polish F0,
 * implementation.md §1.5.1): `POST /api/media` as multipart/form-data via the
 * shared axios client, real progress, abort, and the HTTP-status -> user-text
 * mapping. In its own file for the same `vi.mock` hoisting reason as
 * `useComposePost.live.test.ts`: the mock/live flip is a module-level constant.
 *
 * Pins: the form carries `file`, the `kind` hint and the optional size/poster
 * hints and NEVER an exercise or persona id (COR-001); the request overrides the
 * client's JSON default `Content-Type` so axios hands the FormData to the
 * browser; a non-2xx rejects with the mapped message (nothing swallowed); a
 * malformed 2xx body fails closed; a success invalidates the staff library.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/core/services/queryClient'
import { MEDIA_LIBRARY_QUERY_KEY } from './mediaLibraryKey'
import { isAbortError, MEDIA_ERROR_TEXT, MediaUploadError } from './mediaErrors'

const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { post: postMock },
}))

import { uploadMedia } from './uploadMedia'

interface PostConfig {
  headers?: Record<string, string>
  signal?: AbortSignal
  onUploadProgress?: (event: { progress?: number; loaded: number; total?: number }) => void
}

const ASSET = { id: '7f1c0c0e-0000-4000-8000-000000000001', kind: 'image', url: 'https://blob/x?sig' }

function png(): File {
  return new File([new Uint8Array([1, 2, 3])], 'flood.png', { type: 'image/png' })
}

function lastCall(): { url: string; form: FormData; config: PostConfig } {
  const call = postMock.mock.calls.at(-1)
  if (call === undefined) throw new Error('api.post was not called')
  return { url: call[0] as string, form: call[1] as FormData, config: call[2] as PostConfig }
}

function httpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: 'server text we must not show' },
  })
}

beforeEach(() => {
  postMock.mockReset()
  postMock.mockResolvedValue({ data: ASSET })
})

describe('uploadMedia (live) — the request', () => {
  it('POSTs /media as multipart with the file and the kind hint, and no scope', async () => {
    const file = png()

    await uploadMedia(file)

    const { url, form, config } = lastCall()
    expect(url).toBe('/media')
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('file')).toBeInstanceOf(File)
    expect((form.get('file') as File).name).toBe('flood.png')
    expect(form.get('kind')).toBe('image')
    // The shared client defaults to JSON; the request must override it.
    expect(config.headers?.['Content-Type']).toBe('multipart/form-data')

    // COR-001: no exercise / persona / acting-human identity ever goes up.
    const keys = [...form.keys()]
    expect(keys.filter(key => /exercise|persona|human/i.test(key))).toEqual([])
  })

  it('sends width / height / durationSec / posterMediaId only when supplied', async () => {
    await uploadMedia(png())
    expect([...lastCall().form.keys()].sort()).toEqual(['file', 'kind'])

    await uploadMedia(png(), { width: 1600, height: 900 })
    expect(lastCall().form.get('width')).toBe('1600')
    expect(lastCall().form.get('height')).toBe('900')

    const video = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' })
    await uploadMedia(video, { durationSec: 12.5, posterMediaId: 'poster-1' })
    expect(lastCall().form.get('kind')).toBe('video')
    expect(lastCall().form.get('durationSec')).toBe('12.5')
    expect(lastCall().form.get('posterMediaId')).toBe('poster-1')
  })

  it('does not call the server for a file that fails pre-flight validation', async () => {
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })

    await expect(uploadMedia(file)).rejects.toThrow(MEDIA_ERROR_TEXT.unsupported)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('passes the abort signal to the request', async () => {
    const controller = new AbortController()

    await uploadMedia(png(), { signal: controller.signal })

    expect(lastCall().config.signal).toBe(controller.signal)
  })
})

describe('uploadMedia (live) — result and library freshness', () => {
  it('resolves the created MediaAssetView', async () => {
    await expect(uploadMedia(png())).resolves.toEqual(ASSET)
  })

  it('invalidates the staff media library after a successful upload', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await uploadMedia(png())

    expect(invalidate).toHaveBeenCalledWith({ queryKey: MEDIA_LIBRARY_QUERY_KEY })
    invalidate.mockRestore()
  })

  it('fails closed on a 2xx body that is not an asset', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'x' } })

    await expect(uploadMedia(png())).rejects.toThrow(MEDIA_ERROR_TEXT.failed)
  })
})

describe('uploadMedia (live) — progress', () => {
  it('maps upload events to a clamped, non-decreasing fraction and ends at 1', async () => {
    postMock.mockImplementation((_url: string, _form: FormData, config: PostConfig) => {
      config.onUploadProgress?.({ progress: 0.25, loaded: 25, total: 100 })
      config.onUploadProgress?.({ loaded: 50, total: 100 })
      config.onUploadProgress?.({ progress: 0.4, loaded: 40, total: 100 }) // regression: ignored
      config.onUploadProgress?.({ progress: 7, loaded: 700, total: 100 }) // clamped to 1
      return Promise.resolve({ data: ASSET })
    })
    const seen: number[] = []

    await uploadMedia(png(), { onProgress: f => seen.push(f) })

    expect(seen).toEqual([0.25, 0.5, 1])
  })
})

describe('uploadMedia (live) — failures are mapped and never swallowed', () => {
  it.each([
    [413, MEDIA_ERROR_TEXT.tooLargeImage],
    [415, MEDIA_ERROR_TEXT.unsupported],
    [429, MEDIA_ERROR_TEXT.rateLimited],
    [503, MEDIA_ERROR_TEXT.unavailable],
    [500, MEDIA_ERROR_TEXT.failed],
  ])('maps HTTP %i to the friendly text (never the raw server body)', async (status, text) => {
    postMock.mockRejectedValueOnce(httpError(status))

    const error = await uploadMedia(png()).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MediaUploadError)
    expect((error as MediaUploadError).message).toBe(text)
    expect((error as MediaUploadError).status).toBe(status)
    expect((error as Error).message).not.toMatch(/server text we must not show/)
  })

  it('uses the video-specific 413 text for a video', async () => {
    postMock.mockRejectedValueOnce(httpError(413))
    const video = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' })

    await expect(uploadMedia(video)).rejects.toThrow(MEDIA_ERROR_TEXT.tooLargeVideo)
  })

  it('maps a network failure (no response) to the generic text', async () => {
    postMock.mockRejectedValueOnce(new Error('Network Error'))

    const error = await uploadMedia(png()).catch((e: unknown) => e)

    expect((error as MediaUploadError).message).toBe(MEDIA_ERROR_TEXT.failed)
    expect((error as MediaUploadError).status).toBeUndefined()
  })

  it('turns an axios cancellation into an AbortError', async () => {
    postMock.mockRejectedValueOnce(Object.assign(new Error('canceled'), { name: 'CanceledError' }))

    await expect(uploadMedia(png())).rejects.toSatisfy(isAbortError)
  })
})
