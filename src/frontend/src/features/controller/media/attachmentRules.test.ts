/**
 * features/controller/media/attachmentRules.test.ts
 * ---------------------------------------------------------------------------
 * The pure attach rules (demo-polish C1, story 17): at most 4 images OR 1 video,
 * never mixed; unsupported / oversize files refused with the "MP4 (H.264)" hint;
 * alt text measured AFTER sanitization.
 */
import { describe, expect, it } from 'vitest'
import { fakeFile } from '@/test/fakeMediaUploader'
import {
  MAX_IMAGES,
  MIXED_MEDIA_MESSAGE,
  TOO_MANY_IMAGES_MESSAGE,
  TOO_MANY_VIDEOS_MESSAGE,
  ALT_MAX_LENGTH,
  checkKinds,
  effectiveAlt,
  kindLimit,
  validateAttachBatch,
} from './attachmentRules'

describe('checkKinds', () => {
  it('allows nothing, up to 4 images, or exactly 1 video', () => {
    expect(checkKinds([])).toBeUndefined()
    expect(checkKinds(['image', 'image', 'image', 'image'])).toBeUndefined()
    expect(checkKinds(['video'])).toBeUndefined()
  })

  it('refuses a mixed image + video set', () => {
    expect(checkKinds(['image', 'video'])).toBe(MIXED_MEDIA_MESSAGE)
    expect(checkKinds(['video', 'image'])).toBe(MIXED_MEDIA_MESSAGE)
  })

  it('refuses a second video and a fifth image', () => {
    expect(checkKinds(['video', 'video'])).toBe(TOO_MANY_VIDEOS_MESSAGE)
    expect(checkKinds(Array(MAX_IMAGES + 1).fill('image'))).toBe(TOO_MANY_IMAGES_MESSAGE)
  })
})

describe('kindLimit', () => {
  it('is 4 for images and 1 for video', () => {
    expect(kindLimit('image')).toBe(4)
    expect(kindLimit('video')).toBe(1)
  })
})

describe('validateAttachBatch', () => {
  it('accepts a valid batch and reports the kinds in order', () => {
    const result = validateAttachBatch(
      [fakeFile('a.png', 'image/png'), fakeFile('b.jpg', 'image/jpeg')],
      [],
    )
    expect(result).toEqual({ ok: true, kinds: ['image', 'image'] })
  })

  it('refuses the WHOLE batch on an unsupported file, naming it and carrying the video hint', () => {
    const result = validateAttachBatch(
      [fakeFile('a.png', 'image/png'), fakeFile('notes.pdf', 'application/pdf')],
      [],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('notes.pdf')
      expect(result.error).toContain('MP4 (H.264)')
    }
  })

  it('refuses an oversize image', () => {
    const result = validateAttachBatch([fakeFile('big.png', 'image/png', 6 * 1024 * 1024)], [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/too large/i)
  })

  it('refuses a mixed image + video batch, and a video added to existing images', () => {
    expect(
      validateAttachBatch([fakeFile('a.png', 'image/png'), fakeFile('c.mp4', 'video/mp4')], []),
    ).toEqual({ ok: false, error: MIXED_MEDIA_MESSAGE })
    expect(validateAttachBatch([fakeFile('c.mp4', 'video/mp4')], ['image'])).toEqual({
      ok: false,
      error: MIXED_MEDIA_MESSAGE,
    })
  })

  it('refuses a fifth image and a second video against what is already attached', () => {
    expect(validateAttachBatch([fakeFile('e.png', 'image/png')], ['image', 'image', 'image', 'image']))
      .toEqual({ ok: false, error: TOO_MANY_IMAGES_MESSAGE })
    expect(validateAttachBatch([fakeFile('d.mp4', 'video/mp4')], ['video']))
      .toEqual({ ok: false, error: TOO_MANY_VIDEOS_MESSAGE })
  })
})

describe('effectiveAlt', () => {
  it('trims and strips markup, so a markup-only alt counts as empty', () => {
    expect(effectiveAlt('  Flooded Main Street  ')).toBe('Flooded Main Street')
    expect(effectiveAlt('<b></b>   ')).toBe('')
    expect(effectiveAlt('<script>alert(1)</script>')).toBe('')
  })

  it('is bounded to the server limit', () => {
    expect(effectiveAlt('a'.repeat(ALT_MAX_LENGTH + 50))).toHaveLength(ALT_MAX_LENGTH)
  })
})
