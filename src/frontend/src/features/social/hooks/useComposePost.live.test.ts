/**
 * features/social/hooks/useComposePost.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE branch of `publish()` (the `USE_MOCK_DATA` flip in `useComposePost.ts`;
 * SOC-001, COR-001, COR-053 — and demo-polish F4, story 13):
 *  - LIVE mode AWAITS `livePostActions.publishPost` with the mapped
 *    `CreatePostInput` (`origin: 'participant'`, `media[]` as `{ mediaId, alt }`,
 *    `parentPostId` for a reply);
 *  - it does NOT call `createPost` (no double telemetry: the server emits `post`/
 *    `reply`) and emits NO frontend telemetry of its own;
 *  - on success `onPosted(view)` NOW fires in live mode too, with the 201 body
 *    narrowed to a participant-safe view (a staff-shaped body's provenance never
 *    reaches participant state), the draft clears, and a top-level post is
 *    registered as the viewer's own (a reply is not);
 *  - a FAILED publish no longer vanishes: the text and the attach tray are KEPT,
 *    an in-fiction error is exposed, and calling `publish()` again is Retry; a 2xx
 *    body the client could not parse is worded as "could not confirm";
 *  - nothing is sent while a description is missing or an upload is unfinished.
 *
 * This lives in its own file — mirrors `useReaction.readonly.test.ts`'s own
 * rationale — because `vi.mock('@/core/config/mockData', ...)` is hoisted to the
 * WHOLE module: forcing `USE_MOCK_DATA` false here would also flip the frozen
 * mock/live constants inside `exerciseContextResolver.ts` /
 * `sessionResolver.ts` (WAVE0-REVIEW precedent 15), breaking the REAL
 * `ExerciseContextProvider` / `SessionProvider` the sibling tests rely on. So this
 * file bypasses both providers entirely by mocking `useExerciseContext()` /
 * `useSession()` directly (mirrors `useEngineControl.test.ts`).
 *
 * `../services/postService`'s mock is a FLAT factory (no `importOriginal()`
 * spread — see `useFeed.race.test.ts`'s header for the same Vitest-4.1.10
 * gotcha this sidesteps).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import type { Session } from '@/core/auth'
import { uploadPickedMedia } from '@/core/media'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import type { CreatedPostView, ParticipantPostView } from '@/features/social'
import { publishFailedMessage, publishUnconfirmedMessage, useComposePost } from './useComposePost'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('@/core/auth', () => ({
  useSession: vi.fn(),
}))
vi.mock('@/core/media', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

// Mock the CONCRETE `postService` module (not the whole `@/features/social`
// barrel — that would pull in `Feed`/`Composer`/`SocialChannel` and their own
// heavy dependency graphs just to stub one function). The barrel re-exports
// `createPost` from this exact module path, so `useComposePost.ts`'s barrel
// import sees the same mock. `listPosts` MUST still resolve to a real array
// — `postStore.ts` calls it at MODULE TOP LEVEL (`let posts = listPosts()`),
// and the barrel's full evaluation pulls `postStore.ts` in transitively via
// `Feed`/`feedService`, even though this test only renders the bare hook.
// `toParticipantView`/`originConsoleLabel` are stubbed too, defensively —
// nothing in the LIVE path calls them, but a future addition shouldn't
// silently hit `undefined()`.
vi.mock('../services/postService', () => ({
  createPost: vi.fn(),
  listPosts: () => [],
  toParticipantView: vi.fn(),
  originConsoleLabel: vi.fn(),
}))
vi.mock('../services/livePostActions', () => ({
  publishPost: vi.fn(),
}))

import { createPost } from '../services/postService'
import { publishPost } from '../services/livePostActions'
import { ownPostStore } from '../services/ownPostStore'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'

/** A well-formed 201 body — `publishPost` resolves with the parsed post. */
const PUBLISHED_VIEW: CreatedPostView = {
  id: 'post-published-1',
  authorPersonaId: 'persona-dreyes_fh',
  text: 'published',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00Z',
}

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseSession = vi.mocked(useSession)

function scope(): ExerciseScope {
  return {
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  }
}

function writableSession(): Session {
  return {
    exerciseId: 'ex-live-0001',
    accountId: 'acct-live-participant',
    role: 'participant',
    personaId: 'persona-dreyes_fh',
    actingHumanId: 'human-dreyes',
    isReadOnly: false,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }
}

let uploader: FakeUploader

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scope())
  mockedUseSession.mockReturnValue(writableSession())
  vi.mocked(publishPost).mockReset().mockResolvedValue(PUBLISHED_VIEW)
  vi.mocked(createPost).mockClear()
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
  resetTelemetryBuffer()
})

afterEach(() => {
  ownPostStore.resetForTests()
  resetTelemetryBuffer()
})

describe('useComposePost — LIVE mode publish()', () => {
  it('awaits publishPost with the mapped input; never calls createPost; emits no telemetry', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const { result } = renderHook(() => useComposePost({ onPosted }))

    expect(result.current.canPost).toBe(true)

    act(() => result.current.setText('Zones 2-4 are now clear.'))
    act(() => result.current.publish())

    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({
        authorPersonaId: 'persona-dreyes_fh',
        actingHumanId: 'human-dreyes',
        text: 'Zones 2-4 are now clear.',
        timeZone: 'America/New_York',
        origin: 'participant',
      }),
    )
    // This hook still stamps `exerciseId` for the input shape (stamping-only,
    // COR-001); dropping it from the WIRE body is livePostActions' job (covered
    // end to end in `useComposePost.liveWire.test.ts`).
    const publishedInput = vi.mocked(publishPost).mock.calls[0]?.[0]
    expect(publishedInput?.exerciseId).toBe('ex-live-0001')
    expect(publishedInput).not.toHaveProperty('parentPostId')
    expect(publishedInput).not.toHaveProperty('media')

    expect(createPost).not.toHaveBeenCalled()
    // The server emits post/reply; the client emits nothing (no double count).
    expect(getEmittedTelemetryEvents()).toEqual([])

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    // Draft clears only once the server accepted it.
    expect(result.current.text).toBe('')
  })

  it('fires onPosted with the 201 body narrowed to a participant-safe view', async () => {
    // A STAFF-shaped body (the union admits it): its provenance must not survive.
    vi.mocked(publishPost).mockResolvedValue({
      ...PUBLISHED_VIEW,
      exerciseId: 'ex-live-0001',
      actingHumanId: 'human-dreyes',
      origin: 'participant',
      createdWallClock: '2026-10-08T00:00:00.000Z',
    })
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const { result } = renderHook(() => useComposePost({ onPosted }))

    act(() => result.current.setText('Hello'))
    act(() => result.current.publish())

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.id).toBe('post-published-1')
    expect(view).not.toHaveProperty('exerciseId')
    expect(view).not.toHaveProperty('actingHumanId')
    expect(view).not.toHaveProperty('origin')
    expect(view).not.toHaveProperty('createdWallClock')
    // And a top-level post is registered as the viewer's OWN (instant own post).
    expect(ownPostStore.getAll().map(v => v.id)).toEqual(['post-published-1'])
  })

  it('a reply carries parentPostId, onPosted fires, and it is NOT registered as an own feed post', async () => {
    vi.mocked(publishPost).mockResolvedValue({
      ...PUBLISHED_VIEW,
      id: 'post-reply-1',
      inReplyTo: { postId: 'post-parent-1', authorHandle: 'FulcoEM' },
    })
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const { result } = renderHook(() => useComposePost({ parentPostId: 'post-parent-1', onPosted }))

    act(() => result.current.setText('On it.'))
    act(() => result.current.publish())

    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBe('post-parent-1')
    expect(onPosted.mock.calls[0]?.[0].inReplyTo).toEqual({
      postId: 'post-parent-1',
      authorHandle: 'FulcoEM',
    })
    expect(ownPostStore.getAll()).toEqual([])
    expect(getEmittedTelemetryEvents()).toEqual([])
  })

  it('locks the form while the request is in flight and ignores a second press', async () => {
    let finish: (view: CreatedPostView) => void = () => {}
    vi.mocked(publishPost).mockReturnValue(new Promise<CreatedPostView>(resolve => {
      finish = resolve
    }))
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.setText('Slow one.'))
    act(() => result.current.publish())
    act(() => result.current.publish())

    expect(result.current.isPublishing).toBe(true)
    expect(result.current.canPublish).toBe(false)
    expect(publishPost).toHaveBeenCalledTimes(1)

    await act(async () => finish(PUBLISHED_VIEW))
    expect(result.current.isPublishing).toBe(false)
  })
})

describe('useComposePost — a FAILED publish keeps the draft (never silently drops text)', () => {
  it('keeps text + tray, exposes an in-fiction error, and Retry re-sends the same draft', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error'))
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const { result } = renderHook(() => useComposePost({ onPosted }))

    act(() => result.current.attachFiles([fakeFile('a.png', 'image/png')]))
    await act(async () => {
      uploader.byName('a.png').resolve({ id: 'asset-a' })
    })
    act(() => result.current.setAttachmentAlt(result.current.attachments[0]?.key ?? '', 'A road'))
    act(() => result.current.setText('Roads are closed.'))
    act(() => result.current.publish())

    await waitFor(() => expect(result.current.publishError).toBe(publishFailedMessage(false)))
    // Nothing was lost.
    expect(result.current.text).toBe('Roads are closed.')
    expect(result.current.attachments).toHaveLength(1)
    expect(result.current.attachments[0]?.alt).toBe('A road')
    expect(onPosted).not.toHaveBeenCalled()
    expect(ownPostStore.getAll()).toEqual([])
    expect(result.current.isPublishing).toBe(false)
    expect(result.current.canPublish).toBe(true)

    // Retry: the very same draft goes out again, and the error clears on success.
    act(() => result.current.publish())
    await waitFor(() => expect(onPosted).toHaveBeenCalledTimes(1))
    expect(publishPost).toHaveBeenCalledTimes(2)
    const [first, second] = vi.mocked(publishPost).mock.calls.map(call => call[0])
    expect(second?.text).toBe(first?.text)
    expect(second?.media).toEqual(first?.media)
    expect(result.current.publishError).toBeUndefined()
    expect(result.current.text).toBe('')
    expect(result.current.attachments).toEqual([])
  })

  it('words the failure for a reply as a reply', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error'))
    const { result } = renderHook(() => useComposePost({ parentPostId: 'post-parent-1' }))

    act(() => result.current.setText('Replying.'))
    act(() => result.current.publish())

    await waitFor(() => expect(result.current.publishError).toBe(publishFailedMessage(true)))
    expect(publishFailedMessage(true)).toMatch(/reply/i)
  })

  it('a 2xx body the client could not parse says "could not confirm", and still keeps the draft', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(
      new Error('publishPost: the server returned a malformed post'),
    )
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.setText('Maybe sent.'))
    act(() => result.current.publish())

    await waitFor(() => expect(result.current.publishError).toBe(publishUnconfirmedMessage(false)))
    expect(result.current.publishError).toMatch(/check the feed/i)
    expect(result.current.text).toBe('Maybe sent.')
  })

  it('editing the draft after a failure clears the error banner', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error'))
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.setText('Try.'))
    act(() => result.current.publish())
    await waitFor(() => expect(result.current.publishError).toBeDefined())

    act(() => result.current.setText('Try again.'))

    expect(result.current.publishError).toBeUndefined()
  })

  it('a rejected publishPost never becomes an unhandled rejection', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.setText('Rejected.'))
    expect(() => act(() => result.current.publish())).not.toThrow()

    await waitFor(() => expect(result.current.publishError).toBeDefined())
  })
})

describe('useComposePost — LIVE publish with media', () => {
  it('sends media[] as { mediaId, alt } with the sanitized alt, and nothing else per item', async () => {
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.attachFiles([fakeFile('a.png', 'image/png')]))
    await act(async () => {
      uploader.byName('a.png').resolve({ id: 'asset-a' })
    })
    act(() => {
      result.current.setAttachmentAlt(
        result.current.attachments[0]?.key ?? '',
        'Road <script>x()</script>closed',
      )
    })
    act(() => result.current.publish())

    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].media).toEqual([
      { mediaId: 'asset-a', alt: 'Road closed' },
    ])
  })

  it('does not send while a description is missing or an upload is still running', async () => {
    const { result } = renderHook(() => useComposePost())
    act(() => result.current.setText('Words.'))
    act(() => result.current.attachFiles([fakeFile('a.png', 'image/png')]))

    act(() => result.current.publish())
    expect(publishPost).not.toHaveBeenCalled()

    await act(async () => {
      uploader.byName('a.png').resolve({ id: 'asset-a' })
    })
    act(() => result.current.publish())
    expect(publishPost).not.toHaveBeenCalled()
  })
})
