/**
 * features/social/hooks/useComposePost.media.test.ts
 * ---------------------------------------------------------------------------
 * The ATTACH TRAY of `useComposePost` in MOCK mode (demo-polish F4, story 13
 * "Attach becomes real"; SOC-001, NFR-001, NFR-004), driven through a controllable
 * stand-in for `@/core/media`'s `uploadPickedMedia` (`@/test/fakeMediaUploader`) so
 * progress, completion, failure and cancel are the test's to trigger:
 *
 *  - picked files upload IMMEDIATELY and in parallel, each with its own progress;
 *  - Post is gated: not while anything uploads, not while any alt is missing (an
 *    alt that is only markup is missing), not while an item has failed — and a
 *    photo-only post (no text) is allowed once the tray is ready;
 *  - publishing sends `media[]` as `{ mediaId, alt }` with the SANITIZED alt, emits
 *    exactly one `post` event, hands `onPosted` the view WITH its media, and clears
 *    the tray;
 *  - cancel aborts the upload (and reports nothing); a failed upload shows the
 *    in-fiction message and blocks Post until removed; unmounting aborts what is
 *    in flight;
 *  - a refused pick (mixed / too many / bad type) leaves the tray untouched;
 *  - a REPLY (`parentPostId`) emits one `reply` event with `payload.parentPostId`,
 *    bumps the parent's reply count, links `inReplyTo`, and is not registered as an
 *    own feed post.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { MediaUploadError, MEDIA_ERROR_TEXT, uploadPickedMedia } from '@/core/media'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { ParticipantPostView } from '@/features/social'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { useComposePost, type UseComposePostOptions } from './useComposePost'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'

vi.mock('@/core/media', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ExerciseContextProvider,
    null,
    createElement(SessionProvider, null, children),
  )
}

const png = (name: string) => fakeFile(name, 'image/png')
const mp4 = (name: string) => fakeFile(name, 'video/mp4')

let uploader: FakeUploader

async function renderCompose(options: UseComposePostOptions = {}) {
  const rendered = renderHook(() => useComposePost(options), { wrapper })
  await waitFor(() => expect(rendered.result.current.canPost).toBe(true))
  return rendered
}

/** Picks one image and completes its upload; returns its tray key. */
async function attachReady(
  rendered: Awaited<ReturnType<typeof renderCompose>>,
  name: string,
): Promise<string> {
  act(() => rendered.result.current.attachFiles([png(name)]))
  // The upload settles on a microtask: flush it inside act.
  await act(async () => {
    uploader.byName(name).resolve()
  })
  const added = rendered.result.current.attachments.find(a => a.file.name === name)
  if (added === undefined) throw new Error('attachment missing')
  return added.key
}

beforeEach(() => {
  resetTelemetryBuffer()
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetTelemetryBuffer()
})

describe('useComposePost — picking files uploads them (progress, parallel)', () => {
  it('starts an upload per picked file at once, with independent progress', async () => {
    const { result } = await renderCompose()

    act(() => result.current.attachFiles([png('a.png'), png('b.png'), png('c.png')]))

    expect(uploader.pending).toHaveLength(3)
    expect(result.current.attachments.map(a => a.status)).toEqual([
      'uploading',
      'uploading',
      'uploading',
    ])
    expect(result.current.isUploading).toBe(true)

    act(() => uploader.byName('a.png').progress(0.25))
    act(() => uploader.byName('b.png').progress(0.8))
    const [a, b, c] = result.current.attachments
    expect(a?.progress).toBe(0.25)
    expect(b?.progress).toBe(0.8)
    expect(c?.progress).toBe(0)
  })

  it('marks an item ready (progress 1, asset set) when its upload completes', async () => {
    const { result } = await renderCompose()
    act(() => result.current.attachFiles([png('a.png')]))

    await act(async () => {
      uploader.byName('a.png').resolve()
    })

    const only = result.current.attachments[0]
    expect(only?.status).toBe('ready')
    expect(only?.progress).toBe(1)
    expect(only?.asset?.id).toMatch(/^mock-media-fake-/)
    expect(result.current.isUploading).toBe(false)
  })

  it('classifies a video and uploads it like an image', async () => {
    const { result } = await renderCompose()
    act(() => result.current.attachFiles([mp4('clip.mp4')]))

    expect(result.current.attachments[0]?.kind).toBe('video')
    expect(uploader.pending).toHaveLength(1)
  })
})

describe('useComposePost — Post is gated on uploads and alt text (NFR-001)', () => {
  it('is disabled while uploading, with a reason in words', async () => {
    const { result } = await renderCompose()
    act(() => result.current.setText('Photo from the plant.'))
    act(() => result.current.attachFiles([png('a.png')]))

    expect(result.current.canPublish).toBe(false)
    expect(result.current.mediaBlockReason).toMatch(/waiting for your uploads/i)
  })

  it('stays disabled until EVERY item has a non-empty description', async () => {
    const rendered = await renderCompose()
    const { result } = rendered
    const first = await attachReady(rendered, 'a.png')
    const second = await attachReady(rendered, 'b.png')

    expect(result.current.canPublish).toBe(false)
    expect(result.current.mediaBlockReason).toMatch(/add a description/i)

    act(() => result.current.setAttachmentAlt(first, 'Floodwater on Main Street'))
    expect(result.current.canPublish).toBe(false)

    act(() => result.current.setAttachmentAlt(second, '   '))
    expect(result.current.canPublish).toBe(false)

    act(() => result.current.setAttachmentAlt(second, 'The plant entrance'))
    expect(result.current.canPublish).toBe(true)
    expect(result.current.mediaBlockReason).toBeUndefined()
  })

  it('treats an alt that is only markup as missing', async () => {
    const rendered = await renderCompose()
    const key = await attachReady(rendered, 'a.png')

    act(() => rendered.result.current.setAttachmentAlt(key, '<script>alert(1)</script>'))

    expect(rendered.result.current.canPublish).toBe(false)
  })

  it('allows a photo-only post (no text) once the tray is ready and described', async () => {
    const rendered = await renderCompose()
    const key = await attachReady(rendered, 'a.png')
    act(() => rendered.result.current.setAttachmentAlt(key, 'Floodwater on Main Street'))

    expect(rendered.result.current.text).toBe('')
    expect(rendered.result.current.canPublish).toBe(true)
  })
})

describe('useComposePost — publishing media (MOCK mode)', () => {
  it('sends { mediaId, alt } with the SANITIZED alt, clears the tray, emits ONE post event', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const rendered = await renderCompose({ onPosted })
    const { result } = rendered
    const key = await attachReady(rendered, 'a.png')
    const assetId = result.current.attachments[0]?.asset?.id
    act(() => result.current.setAttachmentAlt(key, 'Water <b>rising</b> on Main Street'))
    act(() => result.current.setText('Zone 3 flooding.'))

    act(() => result.current.publish())

    expect(onPosted).toHaveBeenCalledTimes(1)
    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.media).toHaveLength(1)
    expect(view?.media?.[0]).toMatchObject({
      id: assetId,
      kind: 'image',
      alt: 'Water rising on Main Street',
    })
    // The draft and the tray are cleared; the success is flagged for assistive tech.
    expect(result.current.attachments).toEqual([])
    expect(result.current.text).toBe('')
    expect(result.current.posted).toBe(true)

    const events = getEmittedTelemetryEvents()
    expect(events.filter(e => e.eventType === 'post')).toHaveLength(1)
    expect(events.filter(e => e.eventType === 'reply')).toHaveLength(0)
  })

  it('publishes a photo-only post', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const rendered = await renderCompose({ onPosted })
    const key = await attachReady(rendered, 'a.png')
    act(() => rendered.result.current.setAttachmentAlt(key, 'The plant entrance'))

    act(() => rendered.result.current.publish())

    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.text).toBe('')
    expect(view?.media?.[0]?.alt).toBe('The plant entrance')
  })

  it('publish() is a no-op while a description is missing (nothing is created)', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const rendered = await renderCompose({ onPosted })
    await attachReady(rendered, 'a.png')
    act(() => rendered.result.current.setText('Text is fine.'))

    act(() => rendered.result.current.publish())

    expect(onPosted).not.toHaveBeenCalled()
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'post')).toHaveLength(0)
    expect(rendered.result.current.attachments).toHaveLength(1)
  })

  it('strips a stored <script> from the body on the way out', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const { result } = await renderCompose({ onPosted })

    act(() => result.current.setText('<script>window.__xss = 1</script>safe words'))
    act(() => result.current.publish())

    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.text).toBe('safe words')
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })
})

describe('useComposePost — cancel, remove, failure, unmount', () => {
  it('cancel aborts the upload and drops the item without reporting a failure', async () => {
    const { result } = await renderCompose()
    act(() => result.current.attachFiles([png('a.png')]))
    const key = result.current.attachments[0]?.key ?? ''

    act(() => result.current.cancelAttachment(key))

    expect(uploader.byName('a.png').aborted).toBe(true)
    expect(result.current.attachments).toEqual([])
    expect(result.current.mediaError).toBeUndefined()
    expect(result.current.isUploading).toBe(false)
  })

  it('remove drops a finished item, and the others keep their state', async () => {
    const rendered = await renderCompose()
    const first = await attachReady(rendered, 'a.png')
    await attachReady(rendered, 'b.png')

    act(() => rendered.result.current.removeAttachment(first))

    expect(rendered.result.current.attachments.map(a => a.file.name)).toEqual(['b.png'])
  })

  it('a failed upload shows the in-fiction message and blocks Post until it is removed', async () => {
    const { result } = await renderCompose()
    act(() => result.current.setText('Words are ready.'))
    act(() => result.current.attachFiles([png('a.png')]))

    await act(async () => {
      uploader.byName('a.png').fail(new MediaUploadError(MEDIA_ERROR_TEXT.tooLargeImage, 413))
    })

    await waitFor(() => expect(result.current.attachments[0]?.status).toBe('failed'))
    expect(result.current.attachments[0]?.error).toBe(MEDIA_ERROR_TEXT.tooLargeImage)
    expect(result.current.canPublish).toBe(false)
    expect(result.current.mediaBlockReason).toMatch(/remove the attachment that failed/i)

    act(() => result.current.removeAttachment(result.current.attachments[0]?.key ?? ''))
    expect(result.current.canPublish).toBe(true)
  })

  it('shows a generic in-fiction message for an unexpected (non-media) failure, never its text', async () => {
    const { result } = await renderCompose()
    act(() => result.current.attachFiles([png('a.png')]))

    await act(async () => {
      uploader.byName('a.png').fail(new Error('TypeError: Cannot read properties of undefined'))
    })

    await waitFor(() => expect(result.current.attachments[0]?.status).toBe('failed'))
    expect(result.current.attachments[0]?.error).toBe(MEDIA_ERROR_TEXT.failed)
  })

  it('unmounting aborts every in-flight upload', async () => {
    const { result, unmount } = await renderCompose()
    act(() => result.current.attachFiles([png('a.png'), png('b.png')]))

    unmount()

    expect(uploader.byName('a.png').aborted).toBe(true)
    expect(uploader.byName('b.png').aborted).toBe(true)
  })
})

describe('useComposePost — a refused pick leaves the tray untouched', () => {
  it('refuses a mixed image + video pick with a clear message', async () => {
    const rendered = await renderCompose()
    await attachReady(rendered, 'a.png')
    const before = rendered.result.current.attachments

    act(() => rendered.result.current.attachFiles([mp4('clip.mp4')]))

    expect(rendered.result.current.mediaError).toMatch(/not both/i)
    expect(rendered.result.current.attachments).toBe(before)
    expect(uploader.pending).toHaveLength(1)
  })

  it('refuses a fifth image and a bad file type; a good pick clears the message', async () => {
    const { result } = await renderCompose()
    act(() => result.current.attachFiles([png('1.png'), png('2.png'), png('3.png'), png('4.png')]))
    expect(result.current.attachments).toHaveLength(4)

    act(() => result.current.attachFiles([png('5.png')]))
    expect(result.current.mediaError).toMatch(/up to 4 photos/i)
    expect(result.current.attachments).toHaveLength(4)

    act(() => result.current.removeAttachment(result.current.attachments[0]?.key ?? ''))
    expect(result.current.mediaError).toBeUndefined()

    act(() => result.current.attachFiles([fakeFile('doc.pdf', 'application/pdf')]))
    expect(result.current.mediaError).toMatch(/MP4 \(H\.264\)/)
    expect(result.current.attachments).toHaveLength(3)
  })
})

describe('useComposePost — a reply (parentPostId), MOCK mode', () => {
  it('emits ONE "reply" event with payload.parentPostId, and no "post" event', async () => {
    const { result } = await renderCompose({ parentPostId: 'post-seed-mvega-question' })

    act(() => result.current.setText('We are looking into it.'))
    act(() => result.current.publish())

    const events = getEmittedTelemetryEvents()
    expect(events.filter(e => e.eventType === 'post')).toHaveLength(0)
    const replies = events.filter(e => e.eventType === 'reply')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.payload).toEqual({ parentPostId: 'post-seed-mvega-question' })
  })

  it('hands onPosted a view linked to its parent, bumps the parent count, and is not an own feed post', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const before =
      postStore.getPosts().find(p => p.id === 'post-seed-mvega-question')?.counts.reply ?? -1
    const { result } = await renderCompose({ parentPostId: 'post-seed-mvega-question', onPosted })

    act(() => result.current.setText('We are looking into it.'))
    act(() => result.current.publish())

    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.inReplyTo).toEqual({ postId: 'post-seed-mvega-question', authorHandle: 'mvega_fh' })
    const after = postStore.getPosts().find(p => p.id === 'post-seed-mvega-question')
    expect(after?.counts.reply).toBe(before + 1)
    expect(ownPostStore.getAll()).toEqual([])
  })
})
