/**
 * features/controller/runSheet/libraryView.test.ts
 * ---------------------------------------------------------------------------
 * The run sheet's media-library VIEW (`libraryView.ts`; demo-polish C3 + the Wave 3
 * integration with C1's `useLibraryAssetLookup`): the "All" list as real entries, with a
 * fallback lookup for ids the capped list misses (an asset picked under the picker's
 * Images / Videos filter). Pure, no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import type { StaffMediaAssetView } from '@/core/media'
import { buildLibraryView } from './libraryView'

const asset = (id: string, kind: 'image' | 'video' = 'image'): StaffMediaAssetView => ({
  id,
  kind,
  url: `/mock-media/${id}`,
  fileName: `${id}.bin`,
  uploadedAtScenario: '2033-09-04T12:00:00.000Z',
})

const LISTED = [asset('listed-1'), asset('listed-2')]
const OLD_VIDEO = asset('old-video', 'video')

/** A fallback that knows only the old video (what the picker's Videos filter cached). */
const makeFallback = () =>
  vi.fn((id: string) => (id === OLD_VIDEO.id ? OLD_VIDEO : undefined))

describe('buildLibraryView', () => {
  it('serves the listed assets without asking the fallback', () => {
    const fallback = makeFallback()
    const view = buildLibraryView(LISTED, [], fallback)
    expect(view.get('listed-1')).toBe(LISTED[0])
    expect(view.has('listed-2')).toBe(true)
    expect(view.size).toBe(2)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back for an id the list misses, in get AND has', () => {
    const view = buildLibraryView(LISTED, [], makeFallback())
    expect(view.get(OLD_VIDEO.id)).toBe(OLD_VIDEO)
    expect(view.has(OLD_VIDEO.id)).toBe(true)
  })

  it('still reports an id nobody knows as missing (the "not in the library" note stays)', () => {
    const view = buildLibraryView(LISTED, [], makeFallback())
    expect(view.get('nobody')).toBeUndefined()
    expect(view.has('nobody')).toBe(false)
  })

  it('adds the ids the saved beats reference as real entries, so iteration sees their kind', () => {
    const view = buildLibraryView(LISTED, [OLD_VIDEO.id, 'listed-1', 'nobody'], makeFallback())
    const kinds = new Map<string, string>()
    for (const [id, found] of view) kinds.set(id, found.kind)
    expect(kinds.get(OLD_VIDEO.id)).toBe('video')
    expect(kinds.get('listed-1')).toBe('image')
    // An unresolvable referenced id is not invented.
    expect(kinds.has('nobody')).toBe(false)
    expect(view.size).toBe(3)
  })

  it('does not enumerate fallback-only assets nobody referenced (no leak into iteration)', () => {
    const view = buildLibraryView(LISTED, [], makeFallback())
    expect([...view.keys()]).toEqual(['listed-1', 'listed-2'])
  })

  it('reads the fallback at call time, so an asset cached later resolves on the next render', () => {
    let cached: StaffMediaAssetView | undefined = undefined
    const view = buildLibraryView(LISTED, [], () => cached)
    expect(view.get('late')).toBeUndefined()
    cached = asset('late')
    expect(view.get('late')).toBe(cached)
  })
})
