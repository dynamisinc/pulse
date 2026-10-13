/**
 * features/controller/runSheet/media/mediaRules.test.ts
 * ---------------------------------------------------------------------------
 * The attachment rule (story 06: "<= 4 images OR exactly 1 video, never mixed") applied
 * from the asset kind, and the safe-thumbnail-URL guard.
 */
import { describe, expect, it } from 'vitest'
import { attachReason, safeImageUrl, type AttachKind } from './mediaRules'

const images = (n: number): AttachKind[] => Array.from({ length: n }, () => 'image' as const)

describe('attachReason', () => {
  it('allows an image or a video when nothing is attached', () => {
    expect(attachReason('image', [])).toBeUndefined()
    expect(attachReason('video', [])).toBeUndefined()
    expect(attachReason('unknown', [])).toBeUndefined()
  })

  it('allows images up to the limit of 4, then refuses the fifth', () => {
    for (const n of [1, 2, 3]) expect(attachReason('image', images(n))).toBeUndefined()
    expect(attachReason('image', images(4))).toBe('Limit of 4 reached')
    expect(attachReason('unknown', images(4))).toBe('Limit of 4 reached')
  })

  it('a video must be alone: it cannot join images, and nothing can join it', () => {
    expect(attachReason('video', images(1))).toBe("A video can't be mixed with other media")
    expect(attachReason('image', ['video'])).toBe('A video must be the only attachment')
    expect(attachReason('video', ['video'])).toBe('A video must be the only attachment')
    expect(attachReason('unknown', ['video'])).toBe('A video must be the only attachment')
  })

  it('an unknown kind counts toward the limit but is not blocked by images', () => {
    expect(attachReason('unknown', images(2))).toBeUndefined()
    expect(attachReason('image', ['unknown', 'unknown', 'unknown'])).toBeUndefined()
    expect(attachReason('image', ['unknown', 'unknown', 'unknown', 'unknown'])).toBe('Limit of 4 reached')
  })
})

describe('safeImageUrl', () => {
  it.each([
    ['https://cdn.example.test/a.png', true],
    ['http://localhost:5198/a.png', true],
    ['/mock-media/photos/a.svg', true],
    ['blob:http://localhost/abc', true],
    ['javascript:alert(1)', false],
    ['data:image/svg+xml;base64,AAAA', false],
    ['//evil.example.test/a.png', false],
    ['ftp://example.test/a.png', false],
    ['relative/path.png', false],
    ['', false],
  ])('%s -> %s', (url, safe) => {
    expect(safeImageUrl(url) !== undefined).toBe(safe)
  })

  it('undefined is not a URL', () => {
    expect(safeImageUrl(undefined)).toBeUndefined()
  })
})
