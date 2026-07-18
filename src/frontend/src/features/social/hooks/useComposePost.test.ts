/**
 * features/social/hooks/useComposePost.test.ts
 * ---------------------------------------------------------------------------
 * Pure-logic coverage for the compose helpers that back `<Composer>` (story
 * 01; SOC-001, NFR-004). These functions have no React/provider dependency, so
 * they are tested directly:
 *  - `parseHashtags` / `parseMentions` extract distinct tags/mentions for the
 *    model/telemetry (S2 does not navigate them);
 *  - `validateImageFiles` enforces the media rules (0–4 images, MIME, size)
 *    and rejects a video with the documented inline-video follow-up message.
 *
 * (The hook's stateful/publish behavior is exercised end-to-end through the
 * real component in `../components/Composer.test.tsx`.)
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  parseHashtags,
  parseMentions,
  validateImageFiles,
} from './useComposePost'

function imageFile(name: string, type = 'image/png', size = 1024): File {
  const file = new File(['x'], name, { type })
  // jsdom sets size from content; override it so size validation is exercised
  // without materializing multi-MB blobs.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('parseHashtags', () => {
  it('extracts distinct hashtags, order-preserved, with the # stripped', () => {
    expect(parseHashtags('boil water #Fairhaven #zone2 again #Fairhaven')).toEqual([
      'Fairhaven',
      'zone2',
    ])
  })

  it('returns an empty array when there are no hashtags', () => {
    expect(parseHashtags('just some plain text')).toEqual([])
  })
})

describe('parseMentions', () => {
  it('extracts distinct mentions, order-preserved, with the @ stripped', () => {
    expect(parseMentions('cc @FulcoEM and @FairhavenWater and @FulcoEM')).toEqual([
      'FulcoEM',
      'FairhavenWater',
    ])
  })
})

describe('validateImageFiles', () => {
  it('accepts valid images and maps each to a PostMedia with its filename as alt', () => {
    const result = validateImageFiles(
      [imageFile('flood.png'), imageFile('street.jpg', 'image/jpeg')],
      0,
    )
    expect(result.error).toBeUndefined()
    expect(result.media).toEqual([
      { kind: 'image', alt: 'flood.png' },
      { kind: 'image', alt: 'street.jpg' },
    ])
  })

  it('rejects the batch when it would exceed 4 images total', () => {
    const result = validateImageFiles([imageFile('a.png'), imageFile('b.png')], 3)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/up to 4 images/i)
  })

  it('rejects an unsupported MIME type', () => {
    const result = validateImageFiles([imageFile('doc.pdf', 'application/pdf')], 0)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/isn't supported/i)
  })

  it('rejects an oversized image', () => {
    const result = validateImageFiles([imageFile('huge.png', 'image/png', MAX_IMAGE_BYTES + 1)], 0)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/too large/i)
  })

  it('rejects a video with the documented inline-video follow-up message', () => {
    const result = validateImageFiles([imageFile('clip.mp4', 'video/mp4')], 0)
    expect(result.media).toEqual([])
    expect(result.error).toMatch(/inline video is coming soon/i)
  })
})
