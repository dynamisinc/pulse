/**
 * core/media/validateMediaFile.test.ts
 * ---------------------------------------------------------------------------
 * The pre-flight validation matrix (demo-polish F0; NFR-004 partial): size and
 * MIME only. Pins the per-kind limits (image 5 MiB, video 100 MiB — inclusive),
 * the accepted MIME vocabulary, the "MP4 (H.264)" hint carried by every
 * unsupported-type message, and that the client text is EXACTLY the text the
 * server's 413/415 responses are mapped to (`mediaUploadErrorMessage`).
 */
import { describe, expect, it } from 'vitest'
import {
  IMAGE_MAX_BYTES,
  MEDIA_ERROR_TEXT,
  VIDEO_FORMAT_HINT,
  VIDEO_MAX_BYTES,
  mediaUploadErrorMessage,
} from './mediaErrors'
import { ACCEPT_ANY_MEDIA, ACCEPT_IMAGES_ONLY, validateMediaFile } from './validateMediaFile'

/** A File with a forged `size` — no need to allocate 100 MiB to test a limit. */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File([], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('validateMediaFile — accepted types', () => {
  it.each([
    ['image/jpeg', 'image'],
    ['image/png', 'image'],
    ['image/gif', 'image'],
    ['image/webp', 'image'],
    ['video/mp4', 'video'],
    ['video/webm', 'video'],
  ] as const)('accepts %s as a %s', (type, kind) => {
    expect(validateMediaFile(fakeFile('f', type, 1024))).toEqual({ ok: true, kind })
  })

  it('matches the MIME type case-insensitively', () => {
    expect(validateMediaFile(fakeFile('f.JPG', 'IMAGE/JPEG', 10))).toEqual({
      ok: true,
      kind: 'image',
    })
  })
})

describe('validateMediaFile — size limits are inclusive', () => {
  it('accepts an image of exactly 5 MiB and rejects one byte over', () => {
    expect(validateMediaFile(fakeFile('a.png', 'image/png', IMAGE_MAX_BYTES)).ok).toBe(true)

    const over = validateMediaFile(fakeFile('a.png', 'image/png', IMAGE_MAX_BYTES + 1))
    expect(over).toEqual({ ok: false, error: MEDIA_ERROR_TEXT.tooLargeImage })
  })

  it('accepts a video of exactly 100 MiB and rejects one byte over', () => {
    expect(validateMediaFile(fakeFile('a.mp4', 'video/mp4', VIDEO_MAX_BYTES)).ok).toBe(true)

    const over = validateMediaFile(fakeFile('a.mp4', 'video/mp4', VIDEO_MAX_BYTES + 1))
    expect(over).toEqual({ ok: false, error: MEDIA_ERROR_TEXT.tooLargeVideo })
  })

  it('applies the VIDEO limit to a video that would be oversize as an image', () => {
    // 6 MiB: too big for an image, fine for a video.
    expect(validateMediaFile(fakeFile('a.mp4', 'video/mp4', 6 * 1024 * 1024)).ok).toBe(true)
    expect(validateMediaFile(fakeFile('a.png', 'image/png', 6 * 1024 * 1024)).ok).toBe(false)
  })

  it('rejects an empty file', () => {
    expect(validateMediaFile(fakeFile('a.png', 'image/png', 0))).toEqual({
      ok: false,
      error: MEDIA_ERROR_TEXT.empty,
    })
  })
})

describe('validateMediaFile — unsupported types', () => {
  it.each([
    ['application/pdf'],
    ['image/svg+xml'],
    ['image/bmp'],
    ['video/quicktime'],
    ['video/x-matroska'],
    ['text/html'],
    [''],
  ])('rejects %j', type => {
    expect(validateMediaFile(fakeFile('f', type, 1024))).toEqual({
      ok: false,
      error: MEDIA_ERROR_TEXT.unsupported,
    })
  })

  it('carries the "MP4 (H.264)" video format hint in the unsupported message', () => {
    expect(VIDEO_FORMAT_HINT).toBe('MP4 (H.264)')
    expect(MEDIA_ERROR_TEXT.unsupported).toContain('MP4 (H.264)')
  })
})

describe('error text is shared with the server-status mapping', () => {
  it('maps 413 / 415 to the same strings the client validation returns', () => {
    expect(mediaUploadErrorMessage(413, 'image')).toBe(MEDIA_ERROR_TEXT.tooLargeImage)
    expect(mediaUploadErrorMessage(413, 'video')).toBe(MEDIA_ERROR_TEXT.tooLargeVideo)
    expect(mediaUploadErrorMessage(415)).toBe(MEDIA_ERROR_TEXT.unsupported)
  })

  it('maps a refused request (400 / 401 / 403) to one generic message that does not say why', () => {
    for (const status of [400, 401, 403]) {
      expect(mediaUploadErrorMessage(status, 'image')).toBe(MEDIA_ERROR_TEXT.refused)
    }
    expect(MEDIA_ERROR_TEXT.refused).not.toBe(MEDIA_ERROR_TEXT.failed)
    expect(MEDIA_ERROR_TEXT.refused).not.toBe(MEDIA_ERROR_TEXT.unsupported)
  })

  it('maps 429 / 503 / anything else to friendly text, never a raw body', () => {
    expect(mediaUploadErrorMessage(429)).toBe(MEDIA_ERROR_TEXT.rateLimited)
    expect(mediaUploadErrorMessage(503)).toBe(MEDIA_ERROR_TEXT.unavailable)
    expect(mediaUploadErrorMessage(500)).toBe(MEDIA_ERROR_TEXT.failed)
    expect(mediaUploadErrorMessage(undefined)).toBe(MEDIA_ERROR_TEXT.failed)
  })
})

describe('accept attribute helpers', () => {
  it('lists images and videos together, images alone', () => {
    expect(ACCEPT_ANY_MEDIA.split(',')).toEqual(
      expect.arrayContaining(['image/jpeg', 'image/webp', 'video/mp4', 'video/webm']),
    )
    expect(ACCEPT_IMAGES_ONLY.split(',')).not.toContain('video/mp4')
  })
})
