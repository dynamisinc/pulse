import { describe, expect, it } from 'vitest'
import { MEDIA_ERROR_TEXT, mediaUploadErrorMessage } from './mediaErrors'

describe('mediaUploadErrorMessage (#661 W1)', () => {
  it('maps 409 to a neutral "not accepted right now", never "check your connection"', () => {
    const message = mediaUploadErrorMessage(409)
    expect(message).toBe(MEDIA_ERROR_TEXT.notAcceptedNow)
    expect(message).toMatch(/not accepted right now/i)
    expect(message).not.toMatch(/connection/i)
  })

  it('keeps the existing mappings', () => {
    expect(mediaUploadErrorMessage(403)).toBe(MEDIA_ERROR_TEXT.refused)
    expect(mediaUploadErrorMessage(429)).toBe(MEDIA_ERROR_TEXT.rateLimited)
    expect(mediaUploadErrorMessage(500)).toBe(MEDIA_ERROR_TEXT.failed)
    expect(mediaUploadErrorMessage(undefined)).toBe(MEDIA_ERROR_TEXT.failed)
  })
})
