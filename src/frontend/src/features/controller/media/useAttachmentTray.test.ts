/**
 * features/controller/media/useAttachmentTray.test.ts
 * ---------------------------------------------------------------------------
 * The attach tray's state machine (demo-polish C1, story 17): file batches are
 * validated whole, library picks sync by id and keep their alt text, Fire's
 * `media[]` exists only when everything is uploaded AND described, and the picker
 * is told the right kind / remaining capacity (the frozen `MediaLibraryPicker`
 * props).
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StaffMediaAssetView } from '@/core/media'
import { fakeFile } from '@/test/fakeMediaUploader'
import {
  ALREADY_ATTACHED_MESSAGE,
  MIXED_MEDIA_MESSAGE,
  TOO_MANY_IMAGES_MESSAGE,
} from './attachmentRules'
import { useAttachmentTray } from './useAttachmentTray'

const photo = (id: string, fileName = `${id}.png`): StaffMediaAssetView => ({
  id,
  kind: 'image',
  url: `/mock-media/${fileName}`,
  fileName,
  uploadedAtScenario: '2033-09-04T12:00:00.000Z',
})

const clip: StaffMediaAssetView = {
  id: 'clip-1',
  kind: 'video',
  url: '/mock-media/clip.mp4',
  posterUrl: '/mock-media/clip.poster.svg',
  durationSec: 4,
  fileName: 'clip.mp4',
  uploadedAtScenario: '2033-09-04T12:05:00.000Z',
}

const LIBRARY: Record<string, StaffMediaAssetView> = {
  'img-1': photo('img-1'),
  'img-2': photo('img-2'),
  'img-3': photo('img-3'),
  'img-4': photo('img-4'),
  'img-5': photo('img-5'),
  'clip-1': clip,
}
const lookup = (id: string) => LIBRARY[id]

describe('useAttachmentTray — uploads', () => {
  it('starts empty and sendable as an empty list', () => {
    const { result } = renderHook(() => useAttachmentTray())
    expect(result.current.items).toEqual([])
    expect(result.current.kind).toBeUndefined()
    expect(result.current.media).toEqual([])
    expect(result.current.blocker).toBeUndefined()
  })

  it('adds picked files as uploading rows and blocks Fire until they are uploaded and described', () => {
    const { result } = renderHook(() => useAttachmentTray())

    act(() => {
      result.current.addFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')])
    })

    expect(result.current.items.map(i => [i.name, i.status, i.source])).toEqual([
      ['a.png', 'uploading', 'upload'],
      ['b.png', 'uploading', 'upload'],
    ])
    expect(result.current.uploadingCount).toBe(2)
    expect(result.current.blocker).toBe('Wait for 2 uploads to finish.')
    expect(result.current.media).toBeUndefined()

    const [first, second] = result.current.items
    act(() => result.current.markUploaded(first?.key ?? '', { id: 'asset-a', kind: 'image', url: 'blob:a' }))
    act(() => result.current.markUploaded(second?.key ?? '', { id: 'asset-b', kind: 'image', url: 'blob:b' }))
    expect(result.current.blocker).toBe('Add alt text to every image or video.')
    expect(result.current.missingAltCount).toBe(2)
    expect(result.current.media).toBeUndefined()

    act(() => result.current.setAlt(first?.key ?? '', 'Flooded Main Street'))
    expect(result.current.blocker).toBe('Add alt text to every image or video.')
    act(() => result.current.setAlt(second?.key ?? '', '  Sandbag wall  '))

    expect(result.current.blocker).toBeUndefined()
    expect(result.current.media).toEqual([
      { mediaId: 'asset-a', alt: 'Flooded Main Street' },
      { mediaId: 'asset-b', alt: 'Sandbag wall' },
    ])
  })

  it('treats a markup-only alt as missing (measured after sanitization)', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('a.png', 'image/png')])
    })
    const key = result.current.items[0]?.key ?? ''
    act(() => result.current.markUploaded(key, { id: 'asset-a', kind: 'image', url: 'blob:a' }))
    act(() => result.current.setAlt(key, '<b></b>'))

    expect(result.current.missingAltCount).toBe(1)
    expect(result.current.media).toBeUndefined()
  })

  it('blocks Fire on a failed upload until the row is removed', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('a.png', 'image/png')])
    })
    const key = result.current.items[0]?.key ?? ''
    act(() => result.current.markFailed(key, 'Uploads are not available right now.'))

    expect(result.current.failedCount).toBe(1)
    expect(result.current.blocker).toBe('Remove the failed upload before posting.')
    expect(result.current.media).toBeUndefined()

    act(() => result.current.remove(key))
    expect(result.current.items).toEqual([])
    expect(result.current.blocker).toBeUndefined()
  })

  it('refuses a mixed batch whole, keeps the tray untouched and says why', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('a.png', 'image/png')])
    })

    let accepted = true
    act(() => {
      accepted = result.current.addFiles([fakeFile('c.mp4', 'video/mp4')])
    })

    expect(accepted).toBe(false)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.attachError).toBe(MIXED_MEDIA_MESSAGE)

    // The next accepted attach clears the message.
    act(() => {
      result.current.addFiles([fakeFile('b.png', 'image/png')])
    })
    expect(result.current.attachError).toBeUndefined()
    expect(result.current.items).toHaveLength(2)
  })

  it('refuses a fifth image and an unsupported file (with the MP4 (H.264) hint)', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles(
        ['1', '2', '3', '4'].map(n => fakeFile(`${n}.png`, 'image/png')),
      )
    })
    act(() => {
      result.current.addFiles([fakeFile('5.png', 'image/png')])
    })
    expect(result.current.attachError).toBe(TOO_MANY_IMAGES_MESSAGE)
    expect(result.current.items).toHaveLength(4)

    act(() => {
      result.current.addFiles([fakeFile('notes.txt', 'text/plain')])
    })
    expect(result.current.attachError).toContain('MP4 (H.264)')
  })
})

describe('useAttachmentTray — library picks', () => {
  it('adds library assets as ready rows, keeps their poster, and needs alt before Fire', () => {
    const { result } = renderHook(() => useAttachmentTray())

    act(() => result.current.setLibrarySelection(['clip-1'], lookup))

    const item = result.current.items[0]
    expect(item).toMatchObject({
      source: 'library',
      kind: 'video',
      status: 'ready',
      name: 'clip.mp4',
      uploadedAtScenario: '2033-09-04T12:05:00.000Z',
    })
    expect(item?.asset?.posterUrl).toBe('/mock-media/clip.poster.svg')
    expect(result.current.libraryIds).toEqual(['clip-1'])
    expect(result.current.media).toBeUndefined()

    act(() => result.current.setAlt(item?.key ?? '', 'Water plant briefing'))
    // Only the asset id and alt are sent: the server links the poster from the asset (DP-3).
    expect(result.current.media).toEqual([{ mediaId: 'clip-1', alt: 'Water plant briefing' }])
  })

  it('syncs the tray to the picked ids: new ones added, deselected ones dropped, alt kept', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => result.current.setLibrarySelection(['img-1', 'img-2'], lookup))
    const keep = result.current.items.find(i => i.asset?.id === 'img-1')
    act(() => result.current.setAlt(keep?.key ?? '', 'Kept description'))

    act(() => result.current.setLibrarySelection(['img-1', 'img-3'], lookup))

    expect(result.current.libraryIds).toEqual(['img-1', 'img-3'])
    expect(result.current.items.find(i => i.asset?.id === 'img-1')?.alt).toBe('Kept description')
  })

  it('does not drop uploaded rows when the library selection changes', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('up.png', 'image/png')])
    })
    act(() => result.current.setLibrarySelection(['img-1'], lookup))
    act(() => result.current.setLibrarySelection([], lookup))

    expect(result.current.items.map(i => i.source)).toEqual(['upload'])
  })

  it('refuses a selection that would mix kinds or exceed the limit, leaving the tray untouched', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => result.current.setLibrarySelection(['img-1'], lookup))

    act(() => result.current.setLibrarySelection(['img-1', 'clip-1'], lookup))
    expect(result.current.attachError).toBe(MIXED_MEDIA_MESSAGE)
    expect(result.current.libraryIds).toEqual(['img-1'])

    act(() => result.current.setLibrarySelection(['img-1', 'img-2', 'img-3', 'img-4', 'img-5'], lookup))
    expect(result.current.attachError).toBe(TOO_MANY_IMAGES_MESSAGE)
    expect(result.current.libraryIds).toEqual(['img-1'])
  })

  it('refuses to pick an asset that is already an UPLOAD row - no duplicate mediaId', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('up.png', 'image/png')])
    })
    const key = result.current.items[0]?.key ?? ''
    act(() => result.current.markUploaded(key, { id: 'img-1', kind: 'image', url: 'blob:up' }))

    act(() => result.current.setLibrarySelection(['img-1'], lookup))

    expect(result.current.attachError).toBe(ALREADY_ATTACHED_MESSAGE)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]?.source).toBe('upload')
    expect(result.current.libraryIds).toEqual([])

    // Other picks in the same selection still go through; the message clears afterwards.
    act(() => result.current.setLibrarySelection(['img-1', 'img-2'], lookup))
    expect(result.current.libraryIds).toEqual(['img-2'])
    expect(result.current.attachError).toBe(ALREADY_ATTACHED_MESSAGE)
    act(() => result.current.setLibrarySelection(['img-2'], lookup))
    expect(result.current.attachError).toBeUndefined()
  })

  it('ignores an id the lookup cannot resolve', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => result.current.setLibrarySelection(['nope'], lookup))
    expect(result.current.items).toEqual([])
  })
})

describe('useAttachmentTray — picker limits (the frozen MediaLibraryPicker props)', () => {
  it('an empty tray leaves the picker open to any kind, up to 4', () => {
    const { result } = renderHook(() => useAttachmentTray())
    expect(result.current.libraryLimits).toEqual({ kind: undefined, max: 4 })
  })

  it('narrows the picker to the tray kind and subtracts the uploaded rows from its capacity', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')])
    })
    expect(result.current.libraryLimits).toEqual({ kind: 'image', max: 2 })
  })

  it('leaves a video tray no room for library picks beyond the single video', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => {
      result.current.addFiles([fakeFile('c.mp4', 'video/mp4')])
    })
    expect(result.current.libraryLimits).toEqual({ kind: 'video', max: 0 })
  })

  it('counts library picks against their own selection, not the uploads', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => result.current.setLibrarySelection(['img-1', 'img-2'], lookup))
    expect(result.current.libraryLimits).toEqual({ kind: 'image', max: 4 })
  })
})

describe('useAttachmentTray — clear', () => {
  it('empties the tray and any refusal message', () => {
    const { result } = renderHook(() => useAttachmentTray())
    act(() => result.current.setLibrarySelection(['img-1'], lookup))
    act(() => result.current.setLibrarySelection(['img-1', 'clip-1'], lookup))
    expect(result.current.attachError).toBeDefined()

    act(() => result.current.clear())

    expect(result.current.items).toEqual([])
    expect(result.current.attachError).toBeUndefined()
  })
})
