/**
 * core/media/mockMediaRegistry.test.ts
 * ---------------------------------------------------------------------------
 * The mock-mode registry (demo-polish F0, implementation.md §5): four canned
 * library items out of the box, newest-first listing, kind filter, poster
 * hiding, and a reset that restores exactly the canned set.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  getMockMediaAsset,
  listMockMedia,
  markMockMediaAsPoster,
  registerMockMedia,
  resetMockMediaRegistry,
} from './mockMediaRegistry'

afterEach(() => {
  resetMockMediaRegistry()
})

describe('mockMediaRegistry — canned items', () => {
  it('starts with FOUR canned items: three photos and one video with a poster', () => {
    const items = listMockMedia()

    expect(items).toHaveLength(4)
    expect(items.filter(item => item.kind === 'image')).toHaveLength(3)
    const [video] = items.filter(item => item.kind === 'video')
    expect(video?.posterUrl).toBeTruthy()
    expect(video?.durationSec).toBeGreaterThan(0)
  })

  it('lists newest first by scenario upload time and filters by kind', () => {
    const items = listMockMedia()
    const times = items.map(item => Date.parse(item.uploadedAtScenario))
    expect(times).toEqual([...times].sort((a, b) => b - a))

    expect(listMockMedia('video')).toHaveLength(1)
    expect(listMockMedia('image')).toHaveLength(3)
  })

  it('gives every canned item a staff-library row (file name + scenario time) and a served URL', () => {
    for (const item of listMockMedia()) {
      expect(item.fileName.length).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(item.uploadedAtScenario))).toBe(false)
      expect(item.url.startsWith('/mock-media/')).toBe(true)
    }
  })
})

describe('mockMediaRegistry — registering, posters and reset', () => {
  it('resolves a registered asset by id and lists it first when newest', () => {
    registerMockMedia({
      id: 'mock-media-new',
      kind: 'image',
      url: 'blob:new',
      fileName: 'new.png',
      uploadedAtScenario: '2033-09-04T18:00:00.000Z',
    })

    expect(getMockMediaAsset('mock-media-new')?.fileName).toBe('new.png')
    expect(listMockMedia()[0]?.id).toBe('mock-media-new')
  })

  it('hides an image once it is marked as a video poster, but still resolves it by id', () => {
    registerMockMedia({
      id: 'mock-media-poster',
      kind: 'image',
      url: 'blob:poster',
      fileName: 'poster.jpg',
      uploadedAtScenario: '2033-09-04T18:00:00.000Z',
    })
    expect(listMockMedia().some(item => item.id === 'mock-media-poster')).toBe(true)

    markMockMediaAsPoster('mock-media-poster')

    expect(listMockMedia().some(item => item.id === 'mock-media-poster')).toBe(false)
    expect(getMockMediaAsset('mock-media-poster')?.url).toBe('blob:poster')
  })

  it('ignores marking an unknown id', () => {
    expect(() => markMockMediaAsPoster('nope')).not.toThrow()
  })

  it('reset drops uploads and restores exactly the canned four', () => {
    registerMockMedia({
      id: 'mock-media-x',
      kind: 'image',
      url: 'blob:x',
      fileName: 'x.png',
      uploadedAtScenario: '2033-09-04T18:00:00.000Z',
    })
    resetMockMediaRegistry()

    expect(getMockMediaAsset('mock-media-x')).toBeUndefined()
    expect(listMockMedia()).toHaveLength(4)
  })
})
