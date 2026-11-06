/**
 * News story 05: the hero's pure helpers (crop box, caption classes, progress milestones).
 */
import { describe, expect, it } from 'vitest'
import { CAPTION_STYLES, CROP_AGGRESSIONS } from '@/features/channels'
import { CAPTION_STYLE_CLASS, CROP_BOX_RATIO, croppedHeroMedia, reachedMilestones } from './heroModel'
import { heroImage } from './heroTestUtils'

describe('croppedHeroMedia (CSS crop only; the source is never altered)', () => {
  it('low keeps the source dimensions', () => {
    const media = heroImage()
    expect(croppedHeroMedia(media, 'low')).toBe(media)
  })

  it.each([
    ['medium', 3 / 2],
    ['high', 16 / 9],
  ] as const)('%s frames the box at its ratio and keeps every other field', (crop, ratio) => {
    const media = heroImage()
    const cropped = croppedHeroMedia(media, crop)
    expect((cropped.width ?? 0) / (cropped.height ?? 1)).toBeCloseTo(ratio, 2)
    const { width: _w, height: _h, ...rest } = cropped
    const { width: _ow, height: _oh, ...original } = media
    expect(rest).toEqual(original)
  })

  it('covers every crop aggression and caption style the schema allows', () => {
    for (const crop of CROP_AGGRESSIONS) expect(Object.hasOwn(CROP_BOX_RATIO, crop)).toBe(true)
    for (const style of CAPTION_STYLES) expect(CAPTION_STYLE_CLASS[style]).toBeTruthy()
  })
})

describe('reachedMilestones', () => {
  it('reports nothing without a known duration or before playback', () => {
    expect(reachedMilestones(10, undefined, new Set())).toEqual([])
    expect(reachedMilestones(0, 90, new Set())).toEqual([])
  })

  it('reports 50 at half way and 100 at the end, once each', () => {
    expect(reachedMilestones(44, 90, new Set())).toEqual([])
    expect(reachedMilestones(45, 90, new Set())).toEqual([50])
    expect(reachedMilestones(89.6, 90, new Set([50]))).toEqual([100])
    expect(reachedMilestones(90, 90, new Set([50, 100]))).toEqual([])
  })

  it('a seek past the end reports both at once', () => {
    expect(reachedMilestones(90, 90, new Set())).toEqual([50, 100])
  })
})
