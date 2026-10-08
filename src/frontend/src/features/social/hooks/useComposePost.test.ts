/**
 * features/social/hooks/useComposePost.test.ts
 * ---------------------------------------------------------------------------
 * Pure-logic coverage for the compose helpers that back `<Composer>` (story
 * 01; SOC-001, NFR-004), the attach-tray rules (demo-polish F4), PLUS the
 * mock-mode publish-path regression coverage:
 *  - `parseHashtags` / `parseMentions` extract distinct tags/mentions for the
 *    model/telemetry (S2 does not navigate them);
 *  - `validateAttachBatch` is the attach VALIDATION MATRIX: type, size, empty,
 *    the "MP4 (H.264)" hint, <= 4 images OR exactly 1 video, never mixed, with
 *    the whole batch rejected on the first failure;
 *  - `effectiveAlt` / `toCreatePostMedia` — alt is sanitized and an alt that is
 *    only markup counts as MISSING (so Post can never go out with a blank alt);
 *  - MOCK mode's `publish()` still calls `createPost`, never touches
 *    `livePostActions.publishPost`, and now hands `onPosted` the participant-safe
 *    VIEW (no provenance) — see `useComposePost.media.test.ts` for the tray itself
 *    and `useComposePost.live.test.ts` for the live branch (which needs
 *    `@/core/config/mockData` mocked file-wide).
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, VIDEO_FORMAT_HINT } from '@/core/media'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { ParticipantPostView } from '@/features/social'
import { fakeFile } from '@/test/fakeMediaUploader'
import {
  classifyPublishFailure,
  publishFailedMessage,
  publishRateLimitedMessage,
  publishRefusedMessage,
  publishUnconfirmedMessage,
  MEDIA_MIXED_MESSAGE,
  MEDIA_TOO_MANY_IMAGES_MESSAGE,
  MEDIA_TOO_MANY_VIDEOS_MESSAGE,
  effectiveAlt,
  parseHashtags,
  parseMentions,
  toCreatePostMedia,
  useComposePost,
  validateAttachBatch,
  type ComposerAttachment,
} from './useComposePost'
import { publishPost } from '../services/livePostActions'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'

// The live-persist seam is mocked here purely to assert MOCK mode never calls
// it — `USE_MOCK_DATA` is on by default in this test environment (Vitest runs
// with `import.meta.env.DEV`), so the hook's own branch takes the mock path
// for real; nothing about `@/core/config/mockData` is mocked in this file.
vi.mock('../services/livePostActions', () => ({
  publishPost: vi.fn(),
}))

// This file is `.ts`, not `.tsx` (matches `useReaction.readonly.test.ts`'s own
// note) — `createElement` stands in for JSX in the provider wrapper.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ExerciseContextProvider,
    null,
    createElement(SessionProvider, null, children),
  )
}

const png = (name = 'a.png', size?: number) => fakeFile(name, 'image/png', size)
const mp4 = (name = 'clip.mp4', size?: number) => fakeFile(name, 'video/mp4', size)

function item(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return {
    key: 'k1',
    file: png(),
    kind: 'image',
    status: 'ready',
    progress: 1,
    alt: 'A flooded street',
    asset: { id: 'asset-1', kind: 'image', url: 'blob:1' },
    ...overrides,
  }
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

describe('validateAttachBatch — the attach validation matrix (SOC-001, NFR-004)', () => {
  it('accepts one to four images and reports each kind', () => {
    const result = validateAttachBatch([png('a.png'), fakeFile('b.jpg', 'image/jpeg')], [])
    expect(result).toEqual({ ok: true, kinds: ['image', 'image'] })

    const four = validateAttachBatch([png('1.png'), png('2.png'), png('3.png'), png('4.png')], [])
    expect(four.ok).toBe(true)
  })

  it('accepts exactly one video', () => {
    expect(validateAttachBatch([mp4()], [])).toEqual({ ok: true, kinds: ['video'] })
    expect(validateAttachBatch([fakeFile('c.webm', 'video/webm')], [])).toEqual({
      ok: true,
      kinds: ['video'],
    })
  })

  it('rejects a fifth image, counting what is already in the tray', () => {
    const result = validateAttachBatch([png('e.png'), png('f.png')], ['image', 'image', 'image'])
    expect(result).toEqual({ ok: false, error: MEDIA_TOO_MANY_IMAGES_MESSAGE })
  })

  it('rejects a second video', () => {
    expect(validateAttachBatch([mp4('b.mp4')], ['video'])).toEqual({
      ok: false,
      error: MEDIA_TOO_MANY_VIDEOS_MESSAGE,
    })
    expect(validateAttachBatch([mp4('a.mp4'), mp4('b.mp4')], [])).toEqual({
      ok: false,
      error: MEDIA_TOO_MANY_VIDEOS_MESSAGE,
    })
  })

  it('refuses a mixed image + video pick, in a single batch and across batches', () => {
    const mixed = { ok: false, error: MEDIA_MIXED_MESSAGE }
    expect(validateAttachBatch([png(), mp4()], [])).toEqual(mixed)
    expect(validateAttachBatch([mp4()], ['image'])).toEqual(mixed)
    expect(validateAttachBatch([png()], ['video'])).toEqual(mixed)
    expect(MEDIA_MIXED_MESSAGE).toMatch(/not both/i)
  })

  it('rejects an unsupported type, naming the file and carrying the video format hint', () => {
    const result = validateAttachBatch([fakeFile('doc.pdf', 'application/pdf')], [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('doc.pdf')
    expect(result.error).toContain(VIDEO_FORMAT_HINT)
    expect(result.error).toContain('MP4 (H.264)')
  })

  it('rejects an oversized image and an oversized video with the size limit in the text', () => {
    const image = validateAttachBatch([png('huge.png', IMAGE_MAX_BYTES + 1)], [])
    expect(image.ok).toBe(false)
    if (!image.ok) expect(image.error).toMatch(/too large \(5 MB max\)/i)

    const video = validateAttachBatch([mp4('huge.mp4', VIDEO_MAX_BYTES + 1)], [])
    expect(video.ok).toBe(false)
    if (!video.ok) expect(video.error).toMatch(/too large \(100 MB max\)/i)
  })

  it('rejects an empty file', () => {
    const result = validateAttachBatch([png('empty.png', 0)], [])
    expect(result.ok).toBe(false)
  })

  it('rejects the WHOLE batch on the first bad file (no partial attach)', () => {
    const result = validateAttachBatch([png('good.png'), fakeFile('bad.pdf', 'application/pdf')], [])
    expect(result.ok).toBe(false)
  })

  it('has no "coming soon" video message any more', () => {
    const result = validateAttachBatch([mp4()], [])
    expect(result.ok).toBe(true)
    expect(JSON.stringify([
      MEDIA_MIXED_MESSAGE,
      MEDIA_TOO_MANY_IMAGES_MESSAGE,
      MEDIA_TOO_MANY_VIDEOS_MESSAGE,
    ])).not.toMatch(/coming soon|not available yet/i)
  })
})

describe('effectiveAlt / toCreatePostMedia — alt is mandatory after sanitization (NFR-001, NFR-004)', () => {
  it('trims and strips markup from an alt, keeping the readable text', () => {
    expect(effectiveAlt('  A <b>flooded</b> street  ')).toBe('A flooded street')
  })

  it('treats an alt that is only markup as empty', () => {
    expect(effectiveAlt('<script>alert(1)</script>')).toBe('')
    expect(effectiveAlt('   ')).toBe('')
  })

  it('builds media[] with mediaId + sanitized alt, and nothing else', () => {
    const media = toCreatePostMedia([
      item({ alt: 'One <img src=x onerror=alert(1)>' }),
      item({ key: 'k2', asset: { id: 'asset-2', kind: 'image', url: 'blob:2' }, alt: 'Two' }),
    ])
    expect(media).toEqual([
      { mediaId: 'asset-1', alt: 'One' },
      { mediaId: 'asset-2', alt: 'Two' },
    ])
  })

  it('is not ready (undefined) while an item uploads, failed, or lacks a usable alt', () => {
    expect(toCreatePostMedia([item({ status: 'uploading', progress: 0.4 })])).toBeUndefined()
    expect(toCreatePostMedia([item({ status: 'failed', error: 'x' })])).toBeUndefined()
    expect(toCreatePostMedia([item({ alt: '' })])).toBeUndefined()
    expect(toCreatePostMedia([item({ alt: '<b></b>' })])).toBeUndefined()
  })

  it('is an empty list for an empty tray', () => {
    expect(toCreatePostMedia([])).toEqual([])
  })
})

/** An axios failure as the shared client raises it: with a response when the server answered. */
function axiosFailure(status?: number): AxiosError {
  if (status === undefined) return new AxiosError('Network Error', 'ERR_NETWORK')
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status, data: 'server text that must never be shown' } as AxiosResponse,
  )
}

describe('classifyPublishFailure — what a failure proves decides what the UI may offer (H-1, M-5)', () => {
  it('no response (network down / timeout) and 500/502/503: normally nothing was created -> "failed" (Retry offered)', () => {
    for (const status of [undefined, 500, 502, 503]) {
      expect(classifyPublishFailure(axiosFailure(status), false)).toEqual({
        kind: 'failed',
        message: publishFailedMessage(false),
      })
    }
  })

  it('429 ALONE gets the rate-limit wording; 408 falls through to the normal "failed" message + Retry (W-2)', () => {
    expect(classifyPublishFailure(axiosFailure(429), false)).toEqual({
      kind: 'failed',
      message: publishRateLimitedMessage(false),
    })
    expect(classifyPublishFailure(axiosFailure(408), false)).toEqual({
      kind: 'failed',
      message: publishFailedMessage(false),
    })
    expect(publishFailedMessage(false)).not.toBe(publishRateLimitedMessage(false))
  })

  it('504 (gateway timeout: the origin may have committed) is "unconfirmed", NOT "failed" (S-1)', () => {
    expect(classifyPublishFailure(axiosFailure(504), false)).toEqual({
      kind: 'unconfirmed',
      message: publishUnconfirmedMessage(false),
    })
    // Its neighbours are unchanged.
    expect(classifyPublishFailure(axiosFailure(502), false).kind).toBe('failed')
    expect(classifyPublishFailure(axiosFailure(503), false).kind).toBe('failed')
  })

  it('an AxiosError carrying a 2xx response (an unusable success) is "unconfirmed" (S-1)', () => {
    for (const status of [200, 201, 204]) {
      expect(classifyPublishFailure(axiosFailure(status), false)).toEqual({
        kind: 'unconfirmed',
        message: publishUnconfirmedMessage(false),
      })
    }
  })

  it('400 / 403 / 409 (and any other 4xx): the server refused -> "refused" (no Retry)', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(classifyPublishFailure(axiosFailure(status), false)).toEqual({
        kind: 'refused',
        message: publishRefusedMessage(false),
      })
    }
  })

  it('a non-axios error (a 2xx body that could not be read): the post may exist -> "unconfirmed" (no Retry)', () => {
    expect(classifyPublishFailure(new Error('publishPost: malformed post'), false)).toEqual({
      kind: 'unconfirmed',
      message: publishUnconfirmedMessage(false),
    })
    expect(classifyPublishFailure('boom', true).kind).toBe('unconfirmed')
  })

  it('never shows the server\'s own text, and says "reply" for a reply', () => {
    const refused = classifyPublishFailure(axiosFailure(409), true)

    expect(refused.message).not.toContain('server text')
    expect(refused.message).toMatch(/reply/i)
    expect(refused.message).not.toMatch(/paused|exercise|lifecycle|StartEx|read-only/i)
  })
})

describe('useComposePost — MOCK mode publish()', () => {
  beforeEach(() => {
    resetTelemetryBuffer()
  })

  afterEach(() => {
    vi.mocked(publishPost).mockClear()
    postStore.resetForTests()
    ownPostStore.resetForTests()
    resetTelemetryBuffer()
  })

  it('publishes via createPost + onPosted(view), and never calls livePostActions.publishPost', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const { result } = renderHook(() => useComposePost({ onPosted }), { wrapper })

    await waitFor(() => expect(result.current.canPost).toBe(true))

    act(() => result.current.setText('Boil-water advisory lifted for zone 3.'))
    act(() => result.current.publish())

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.text).toBe('Boil-water advisory lifted for zone 3.')
    expect(view?.authorPersonaId).toBe('persona-dreyes_fh')
    // The view is participant-safe: provenance is structurally absent (XC-002).
    expect(view).not.toHaveProperty('origin')
    expect(view).not.toHaveProperty('actingHumanId')
    expect(view).not.toHaveProperty('createdWallClock')

    expect(publishPost).not.toHaveBeenCalled()
    // The mock backend stored it, and the viewer's own-post store has it.
    expect(postStore.getPosts().some(post => post.id === view?.id)).toBe(true)
    expect(ownPostStore.has(view?.id ?? '')).toBe(true)
  })

  it('emits exactly one "post" telemetry event per publish (mock mode)', async () => {
    const { result } = renderHook(() => useComposePost(), { wrapper })
    await waitFor(() => expect(result.current.canPost).toBe(true))

    act(() => result.current.setText('One post.'))
    act(() => result.current.publish())

    const events = getEmittedTelemetryEvents()
    expect(events.filter(e => e.eventType === 'post')).toHaveLength(1)
    expect(events.filter(e => e.eventType === 'reply')).toHaveLength(0)
  })

  it('a text that is only markup is not a post (it sanitizes to nothing)', async () => {
    const { result } = renderHook(() => useComposePost(), { wrapper })
    await waitFor(() => expect(result.current.canPost).toBe(true))

    act(() => result.current.setText('<b></b>'))

    expect(result.current.canPublish).toBe(false)
    act(() => result.current.publish())
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'post')).toHaveLength(0)
  })
})
