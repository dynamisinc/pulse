/**
 * features/social/components/media/formatDuration.test.ts
 * ---------------------------------------------------------------------------
 * The video duration badge text (demo-polish F2): a media LENGTH, not a clock.
 * Also pins `singleMediaAspectRatio` (the no-layout-shift clamp) and `mediaAlt`
 * (alt is never empty) since they are the other tiny pure helpers.
 */
import { describe, expect, it } from 'vitest'
import { formatDuration } from './formatDuration'
import { DEFAULT_ASPECT_RATIO, mediaAlt, singleMediaAspectRatio } from './mediaLayout'

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [4, '0:04'],
    [24, '0:24'],
    [59, '0:59'],
    [60, '1:00'],
    [65, '1:05'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('formats %s s as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text)
  })

  it('rounds fractional seconds to the nearest second', () => {
    expect(formatDuration(4.083333)).toBe('0:04')
    expect(formatDuration(23.6)).toBe('0:24')
    expect(formatDuration(59.6)).toBe('1:00')
  })

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [-5]])('renders %s as 0:00', value => {
    expect(formatDuration(value)).toBe('0:00')
  })
})

describe('singleMediaAspectRatio', () => {
  it('uses the natural ratio inside the 4:5 ... 16:9 band', () => {
    expect(singleMediaAspectRatio(1200, 800)).toBeCloseTo(1.5)
    expect(singleMediaAspectRatio(1000, 1000)).toBe(1)
  })

  it('clamps a tall portrait to 4:5 and a panorama to 16:9', () => {
    expect(singleMediaAspectRatio(800, 1200)).toBeCloseTo(0.8)
    expect(singleMediaAspectRatio(4000, 1000)).toBeCloseTo(16 / 9)
  })

  it('falls back to 16:9 for missing, zero, negative or non-finite dimensions', () => {
    expect(singleMediaAspectRatio()).toBe(DEFAULT_ASPECT_RATIO)
    expect(singleMediaAspectRatio(100)).toBe(DEFAULT_ASPECT_RATIO)
    expect(singleMediaAspectRatio(0, 100)).toBe(DEFAULT_ASPECT_RATIO)
    expect(singleMediaAspectRatio(100, -1)).toBe(DEFAULT_ASPECT_RATIO)
    expect(singleMediaAspectRatio(Number.NaN, 100)).toBe(DEFAULT_ASPECT_RATIO)
  })
})

describe('mediaAlt', () => {
  it('returns the contract alt', () => {
    expect(mediaAlt({ alt: 'Floodwater on Main Street', kind: 'image' })).toBe('Floodwater on Main Street')
  })

  it('never returns an empty string — blank, missing or non-string alt gets a neutral description', () => {
    expect(mediaAlt({ alt: '', kind: 'image' })).toBe('Photo attached to this post')
    expect(mediaAlt({ alt: '   ', kind: 'image' })).toBe('Photo attached to this post')
    expect(mediaAlt({ kind: 'video' })).toBe('Video attached to this post')
    expect(mediaAlt({ alt: 7, kind: 'video' })).toBe('Video attached to this post')
  })
})
