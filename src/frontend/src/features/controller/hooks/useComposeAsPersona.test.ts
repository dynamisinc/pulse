/**
 * features/controller/hooks/useComposeAsPersona.test.ts
 * ---------------------------------------------------------------------------
 * The controller persona-compose hook in LIVE mode (persona-operation/01 +
 * demo-polish C1, story 17; CTL-001, COR-001, COR-018, COR-053, XC-004):
 *  - This file is LIVE-mode only - it forces `USE_MOCK_DATA` false file-wide (see the
 *    flat `vi.mock` below). MOCK mode's coverage lives in `useComposeAsPersona.mock.
 *    test.ts` and in `../components/PersonaComposer*.test.tsx` (the real providers);
 *  - LIVE publish AWAITS `livePostActions.publishPost` with `origin:
 *    'controller-as-persona'` and no client `exerciseId` (COR-001), and does NOT also
 *    call the local `createPost` - the server is the sole XC-004 emitter, so exactly
 *    ONE event is emitted per post (the former double-count is retired);
 *  - the old swallowed `.catch(() => {})` is gone: a rejection leaves `status ===
 *    'error'` with the server's message, KEEPS the whole draft, never reaches the
 *    success state, and calling `publish()` again is the Retry;
 *  - reply (`parentPostId`), media (`media[]`), baseline (`engagementBaseline`) ride on
 *    the body; an invalid baseline / un-described attachment blocks Fire;
 *  - a response that lands after the controller switched persona never touches the new
 *    persona's draft.
 *
 * `@/core/exerciseContext` is mocked directly (mirrors `useEngineControl.test.ts`) -
 * no provider tree needed. `@/core/services/api` is mocked so the mock telemetry sink
 * never touches the network.
 *
 * Also covers the DRAFT-SURVIVES-UNMOUNT store (autonomy-safety story 06, Gate-1
 * WR-103). The EXPLICIT discard path (Esc/X on the persona dock) lives in
 * `ControllerConsole`'s `closeDock` and is covered end-to-end in
 * `ControllerConsole.personaDraftDiscard.test.tsx`.
 */
import { useLayoutEffect, useRef } from 'react'
import { act, renderHook } from '@testing-library/react'
import { AxiosError } from 'axios'
import { toast } from 'react-toastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { StaffMediaAssetView } from '@/core/media'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView, Post, ReplyTarget } from '@/features/social'
import {
  composeAsPersonaDraftStore,
  useComposeAsPersona,
  type UseComposeAsPersonaOptions,
} from './useComposeAsPersona'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

vi.mock('@/features/social/services/livePostActions', () => ({
  publishPost: vi.fn(),
}))

vi.mock('react-toastify', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}))

// This whole file exercises the LIVE branch only.
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { publishPost } from '@/features/social/services/livePostActions'

/** A well-formed 201 `StaffPostDto` - `publishPost` resolves with the parsed post. */
const PUBLISHED_VIEW: CreatedPostView = {
  id: 'post-published-1',
  authorPersonaId: 'persona-fairhavenwater',
  text: 'published',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00Z',
}

const mockedUseExerciseContext = vi.mocked(useExerciseContext)

function scope(): ExerciseScope {
  return {
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  }
}

// STAFF fixture (the console's active persona is a `StaffPersona`); the hook
// itself declares only the narrower `Persona` it actually reads.
const ACTIVE_PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-live-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

const OTHER_PERSONA: StaffPersona = { ...ACTIVE_PERSONA, id: 'persona-other', handle: 'Other' }

const REPLY_TARGET: ReplyTarget = {
  postId: 'post-pio-1',
  authorHandle: 'pio_jones',
  authorDisplayName: 'PIO Jones',
  excerpt: 'Is the water safe to drink?',
}

const LIBRARY_PHOTO: StaffMediaAssetView = {
  id: 'asset-lib-1',
  kind: 'image',
  url: 'https://blob.example.test/a.png',
  fileName: 'a.png',
  uploadedAtScenario: '2033-09-04T12:00:00.000Z',
}

function options(overrides: Partial<UseComposeAsPersonaOptions> = {}): UseComposeAsPersonaOptions {
  return { activePersona: ACTIVE_PERSONA, actingHumanId: 'human-ctl-7', ...overrides }
}

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data,
  })
}

/** A `publishPost` call the test settles by hand. */
function deferredPublish() {
  let resolve: (view: CreatedPostView) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<CreatedPostView>((res, rej) => {
    resolve = res
    reject = rej
  })
  vi.mocked(publishPost).mockReturnValueOnce(promise)
  return { resolve, reject }
}

/** The body most recently handed to `publishPost`. */
function lastBody() {
  const calls = vi.mocked(publishPost).mock.calls
  return calls[calls.length - 1]?.[0]
}

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scope())
  vi.mocked(publishPost).mockReset().mockResolvedValue(PUBLISHED_VIEW)
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
  resetTelemetryBuffer()
  // Gate-1 WR-103's persisted-draft store is a module singleton keyed by
  // (exerciseId, personaId) - several tests below reuse the SAME
  // persona/exercise, so reset it between tests.
  composeAsPersonaDraftStore.resetForTests()
})

describe('useComposeAsPersona — LIVE publish is awaited and visible', () => {
  it('posts as the persona, then (only then) clears the draft, fires onPublished and says Posted', async () => {
    const pending = deferredPublish()
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = renderHook(() => useComposeAsPersona(options({ onPublished })))

    act(() => result.current.setText('Zones 2-4 are now clear.'))
    act(() => result.current.publish())

    // In flight: locked, not yet "published", draft still there.
    expect(result.current.status).toBe('publishing')
    expect(result.current.isPublishing).toBe(true)
    expect(result.current.canPublish).toBe(false)
    expect(result.current.text).toBe('Zones 2-4 are now clear.')
    expect(onPublished).not.toHaveBeenCalled()
    expect(lastBody()).toMatchObject({
      authorPersonaId: 'persona-fairhavenwater',
      actingHumanId: 'human-ctl-7',
      text: 'Zones 2-4 are now clear.',
      timeZone: 'America/New_York',
      origin: 'controller-as-persona',
    })

    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(result.current.status).toBe('success')
    expect(result.current.failure).toBeUndefined()
    expect(result.current.text).toBe('')
    expect(onPublished).toHaveBeenCalledTimes(1)
    // The Post is built from the 201 body (the server's id and scenario time).
    const post = onPublished.mock.calls[0]?.[0]
    expect(post).toMatchObject({
      id: 'post-published-1',
      origin: 'controller-as-persona',
      actingHumanId: 'human-ctl-7',
      scenarioTime: '2033-09-04T14:00:00Z',
    })
    expect(result.current.lastPublished).toBe(post)
  })

  it('stamps the post with a scenario instant, and never sends an exercise id (COR-001, COR-053)', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Timing.'))
    await act(async () => result.current.publish())

    const body = lastBody()
    expect(body?.scenarioTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The input carries exerciseId for stamping only; `publishPost` drops it from the wire
    // (asserted at the wire level in `composeService.v2.test.ts`).
    expect(body?.exerciseId).toBe('ex-live-0001')
  })

  it('does NOT also call createPost: exactly ONE XC-004 event per post (the server\'s) - none from the client', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('One event, not two.'))
    await act(async () => result.current.publish())

    expect(publishPost).toHaveBeenCalledTimes(1)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('a second publish while one is in flight is ignored', async () => {
    const pending = deferredPublish()
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Only once.'))

    act(() => result.current.publish())
    act(() => result.current.publish())
    act(() => result.current.publish())

    expect(publishPost).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(PUBLISHED_VIEW))
  })
})

describe('useComposeAsPersona — a failed publish is VISIBLE and keeps the draft', () => {
  it('shows the server\'s message, never reaches success, keeps text / tray / baseline, and Retry works', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(400, 'media is not yours.'))
    const onPublished = vi.fn<(post: Post) => void>()
    const onClearReply = vi.fn()
    const { result } = renderHook(() =>
      useComposeAsPersona(options({ onPublished, replyTo: REPLY_TARGET, onClearReply })),
    )
    act(() => result.current.setText('Draft that must survive.'))
    act(() => result.current.tray.setLibrarySelection([LIBRARY_PHOTO.id], () => LIBRARY_PHOTO))
    act(() => result.current.tray.setAlt(result.current.tray.items[0]?.key ?? '', 'Zone map'))
    act(() => result.current.setBaselineField('like', '1200'))

    await act(async () => result.current.publish())

    expect(result.current.status).toBe('error')
    expect(result.current.failure).toEqual({
      kind: 'rejected',
      status: 400,
      message: 'media is not yours.',
    })
    expect(result.current.lastPublished).toBeNull()
    expect(onPublished).not.toHaveBeenCalled()
    expect(onClearReply).not.toHaveBeenCalled()
    // The whole draft is intact.
    expect(result.current.text).toBe('Draft that must survive.')
    expect(result.current.tray.items).toHaveLength(1)
    expect(result.current.baselineFields.like).toBe('1200')
    expect(result.current.canPublish).toBe(true)

    // Retry = publish() again with the same draft; success then clears it.
    await act(async () => result.current.publish())

    expect(publishPost).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('success')
    expect(result.current.failure).toBeUndefined()
    expect(result.current.text).toBe('')
    expect(result.current.tray.items).toHaveLength(0)
    expect(result.current.baselineFields.like).toBe('')
    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('a 429 answer is "failed" (retry is reasonable); a 5xx and an unreadable 2xx are "unconfirmed"', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(429, { error: 'rate_limited' }))
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Server busy.'))
    await act(async () => result.current.publish())
    expect(result.current.failure?.kind).toBe('failed')
    expect(result.current.awaitingDecision).toBe(false)
    expect(result.current.canPublish).toBe(true)

    // Gate-2 A M-3: a 5xx may follow a commit, so it is gated exactly like a 504.
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(503, { error: 'unavailable' }))
    await act(async () => result.current.publish())
    expect(result.current.failure).toMatchObject({ kind: 'unconfirmed', status: 503 })
    expect(result.current.awaitingDecision).toBe(true)
    expect(result.current.canPublish).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.text).toBe('Server busy.')
    expect(publishPost).toHaveBeenCalledTimes(2)

    await act(async () => result.current.discardUnconfirmed())
    vi.mocked(publishPost).mockRejectedValueOnce(
      new Error('publishPost: the server returned a malformed post'),
    )
    act(() => result.current.setText('Server busy.'))
    await act(async () => result.current.publish())
    expect(result.current.failure?.kind).toBe('unconfirmed')
    expect(result.current.status).toBe('error')
    expect(result.current.text).toBe('Server busy.')
  })

  it('keeps the persisted draft on failure, so an unmount does not lose it', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(503, { error: 'unavailable' }))
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('Still here.'))
    await act(async () => first.result.current.publish())
    first.unmount()

    const second = renderHook(() => useComposeAsPersona(options()))
    expect(second.result.current.text).toBe('Still here.')
  })
})

describe('useComposeAsPersona — reply, media and baseline ride on the body', () => {
  it('sends parentPostId for a reply and asks the route to clear the target once it is out', async () => {
    const onClearReply = vi.fn()
    const { result } = renderHook(() =>
      useComposeAsPersona(options({ replyTo: REPLY_TARGET, onClearReply })),
    )
    act(() => result.current.setText('Yes - the advisory is lifted for Zone 3.'))

    await act(async () => result.current.publish())

    expect(lastBody()?.parentPostId).toBe('post-pio-1')
    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('a normal post (no reply target) carries no parentPostId', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Plain post.'))
    await act(async () => result.current.publish())
    expect(lastBody()).not.toHaveProperty('parentPostId')
  })

  it('sends the described media as { mediaId, alt } only after every item has alt text', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Photo update.'))
    act(() => result.current.tray.setLibrarySelection([LIBRARY_PHOTO.id], () => LIBRARY_PHOTO))

    // No alt yet: Fire is blocked and publish() is a no-op.
    expect(result.current.canPublish).toBe(false)
    expect(result.current.blockers).toContain('Add alt text to every image or video.')
    act(() => result.current.publish())
    expect(publishPost).not.toHaveBeenCalled()

    act(() => result.current.tray.setAlt(result.current.tray.items[0]?.key ?? '', '  Zone map  '))
    expect(result.current.canPublish).toBe(true)
    await act(async () => result.current.publish())

    expect(lastBody()?.media).toEqual([{ mediaId: 'asset-lib-1', alt: 'Zone map' }])
  })

  it('allows a media-only post (no text) once everything is described', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.tray.setLibrarySelection([LIBRARY_PHOTO.id], () => LIBRARY_PHOTO))
    act(() => result.current.tray.setAlt(result.current.tray.items[0]?.key ?? '', 'Zone map'))

    expect(result.current.canPublish).toBe(true)
    await act(async () => result.current.publish())

    expect(lastBody()?.text).toBe('')
    expect(lastBody()?.media).toHaveLength(1)
  })

  it('sends a valid baseline as engagementBaseline, and sends none by default', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Trending.'))
    await act(async () => result.current.publish())
    expect(lastBody()).not.toHaveProperty('engagementBaseline')

    act(() => result.current.setText('Trending again.'))
    act(() => result.current.setBaselineField('like', '2300'))
    act(() => result.current.setBaselineField('reply', '0'))
    expect(result.current.baseline).toEqual({ like: 2300, reply: 0 })
    await act(async () => result.current.publish())

    expect(lastBody()?.engagementBaseline).toEqual({ like: 2300, reply: 0 })
  })

  it.each([
    ['1000001', 'above the maximum'],
    ['-1', 'negative'],
    ['12.5', 'fractional'],
    ['lots', 'not a number'],
  ])('an invalid baseline (%s, %s) blocks Fire with an inline message', value => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Blocked.'))
    act(() => result.current.setBaselineField('repost', value))

    expect(result.current.canPublish).toBe(false)
    expect(result.current.baseline).toBeUndefined()
    expect(result.current.baselineErrors.repost).toBe('Enter a whole number from 0 to 1,000,000.')
    expect(result.current.blockers.join(' ')).toMatch(/Starting engagement/)

    act(() => result.current.publish())
    expect(publishPost).not.toHaveBeenCalled()

    // Fixing it unblocks.
    act(() => result.current.setBaselineField('repost', '340'))
    expect(result.current.canPublish).toBe(true)
    expect(result.current.baselineErrors.repost).toBeUndefined()
  })
})

describe('useComposeAsPersona — a response for a persona you left', () => {
  it('lands without touching the new persona\'s draft or status, but still reports the post', async () => {
    const pending = deferredPublish()
    const onPublished = vi.fn<(post: Post) => void>()
    const { result, rerender } = renderHook(
      ({ persona }) => useComposeAsPersona(options({ activePersona: persona, onPublished })),
      { initialProps: { persona: ACTIVE_PERSONA as StaffPersona } },
    )
    act(() => result.current.setText('For Fairhaven Water.'))
    act(() => result.current.publish())

    rerender({ persona: OTHER_PERSONA })
    act(() => result.current.setText('Typing as someone else.'))
    expect(result.current.status).toBe('idle')

    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(result.current.text).toBe('Typing as someone else.')
    expect(result.current.status).toBe('idle')
    expect(result.current.lastPublished).toBeNull()
    expect(onPublished).toHaveBeenCalledTimes(1)
    // The sent persona's persisted draft is gone.
    const back = renderHook(() => useComposeAsPersona(options()))
    expect(back.result.current.text).toBe('')
  })

  it('a switch of persona drops the previous persona\'s error banner and tray', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(403, 'Exercise is not live.'))
    const { result, rerender } = renderHook(
      ({ persona }) => useComposeAsPersona(options({ activePersona: persona })),
      { initialProps: { persona: ACTIVE_PERSONA as StaffPersona } },
    )
    act(() => result.current.setText('Will fail.'))
    act(() => result.current.tray.setLibrarySelection([LIBRARY_PHOTO.id], () => LIBRARY_PHOTO))
    act(() => result.current.tray.setAlt(result.current.tray.items[0]?.key ?? '', 'Zone map'))
    await act(async () => result.current.publish())
    expect(result.current.status).toBe('error')

    rerender({ persona: OTHER_PERSONA })

    expect(result.current.status).toBe('idle')
    expect(result.current.failure).toBeUndefined()
    expect(result.current.tray.items).toHaveLength(0)
  })
})

describe('useComposeAsPersona — a post that MAY ALREADY BE LIVE is not blindly re-sent', () => {
  const OTHER_TARGET: ReplyTarget = { ...REPLY_TARGET, postId: 'post-other', authorHandle: 'other' }

  async function unconfirmedDraft(extra: Partial<UseComposeAsPersonaOptions> = {}) {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504, undefined))
    const hook = renderHook(
      (props: Partial<UseComposeAsPersonaOptions>) => useComposeAsPersona(options(props)),
      { initialProps: extra },
    )
    act(() => hook.result.current.setText('Breaking: boil-water order lifted.'))
    await act(async () => hook.result.current.publish())
    return hook
  }

  it('after a 504 Post is paused: publish() is a no-op and the draft is kept', async () => {
    const { result } = await unconfirmedDraft()

    expect(result.current.status).toBe('error')
    expect(result.current.failure).toMatchObject({ kind: 'unconfirmed', status: 504 })
    expect(result.current.awaitingDecision).toBe(true)
    expect(result.current.canPublish).toBe(false)
    expect(result.current.blockers.join(' ')).toMatch(/Post is paused/)
    expect(result.current.text).toBe('Breaking: boil-water order lifted.')

    // One Enter, one Ctrl+Enter, one click: all of them end in publish(), which does nothing.
    act(() => result.current.publish())
    act(() => result.current.publish())
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('NO response at all (a dropped connection) pauses Post exactly like a 504', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Dropped.'))
    await act(async () => result.current.publish())

    expect(result.current.failure?.kind).toBe('unconfirmed')
    expect(result.current.awaitingDecision).toBe(true)
    act(() => result.current.publish())
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('"post again anyway" re-sends the kept draft past the gate, and success clears it', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = await unconfirmedDraft({ onPublished })

    await act(async () => result.current.repostAnyway())

    expect(publishPost).toHaveBeenCalledTimes(2)
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].text).toBe('Breaking: boil-water order lifted.')
    expect(result.current.status).toBe('success')
    expect(result.current.awaitingDecision).toBe(false)
    expect(result.current.text).toBe('')
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('repostAnyway is a no-op when nothing is unconfirmed (it is not a back door around canPublish)', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Never failed.'))

    act(() => result.current.repostAnyway())

    expect(publishPost).not.toHaveBeenCalled()
  })

  it('a SECOND outcome that is a plain refusal lifts the gate (the server said it took nothing)', async () => {
    const { result } = await unconfirmedDraft()
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(400, 'media is not yours.'))

    await act(async () => result.current.repostAnyway())

    expect(result.current.failure?.kind).toBe('rejected')
    expect(result.current.awaitingDecision).toBe(false)
    expect(result.current.canPublish).toBe(true)
  })

  it('"discard (it went out)" drops the draft, the gate and the answered reply target - without posting', async () => {
    const onClearReply = vi.fn()
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = await unconfirmedDraft({
      replyTo: REPLY_TARGET,
      onClearReply,
      onPublished,
    })
    act(() => result.current.tray.setLibrarySelection([LIBRARY_PHOTO.id], () => LIBRARY_PHOTO))

    act(() => result.current.discardUnconfirmed())

    expect(publishPost).toHaveBeenCalledTimes(1)
    expect(onPublished).not.toHaveBeenCalled()
    expect(result.current.text).toBe('')
    expect(result.current.tray.items).toHaveLength(0)
    expect(result.current.status).toBe('idle')
    expect(result.current.failure).toBeUndefined()
    expect(result.current.awaitingDecision).toBe(false)
    expect(onClearReply).toHaveBeenCalledTimes(1)
    // The persisted draft went with it: a remount starts empty and ungated.
    const again = renderHook(() => useComposeAsPersona(options()))
    expect(again.result.current.text).toBe('')
    expect(again.result.current.awaitingDecision).toBe(false)
  })

  it('"discard" leaves a DIFFERENT reply target alone', async () => {
    const onClearReply = vi.fn()
    const { result, rerender } = await unconfirmedDraft({ replyTo: REPLY_TARGET, onClearReply })
    rerender({ replyTo: OTHER_TARGET, onClearReply })

    act(() => result.current.discardUnconfirmed())

    expect(onClearReply).not.toHaveBeenCalled()
  })

  it('discardUnconfirmed is a no-op when nothing is unconfirmed', async () => {
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Keep me.'))

    act(() => result.current.discardUnconfirmed())

    expect(result.current.text).toBe('Keep me.')
  })

  it('a remount for the same persona comes back STILL asking (the dock closed and reopened)', async () => {
    const first = await unconfirmedDraft()
    first.unmount()

    const second = renderHook(() => useComposeAsPersona(options()))

    expect(second.result.current.text).toBe('Breaking: boil-water order lifted.')
    expect(second.result.current.awaitingDecision).toBe(true)
    expect(second.result.current.status).toBe('error')
    act(() => second.result.current.publish())
    expect(publishPost).toHaveBeenCalledTimes(1)

    // The explicit Esc/X discard is the controller's choice to walk away: it clears the gate.
    second.unmount()
    composeAsPersonaDraftStore.discardDraft('ex-live-0001', ACTIVE_PERSONA.id)
    const third = renderHook(() => useComposeAsPersona(options()))
    expect(third.result.current.awaitingDecision).toBe(false)
    expect(third.result.current.text).toBe('')
  })
})

describe('useComposeAsPersona — a stale response never clears a NEWER reply target', () => {
  const OTHER_TARGET: ReplyTarget = { ...REPLY_TARGET, postId: 'post-other', authorHandle: 'other' }

  it('a normal post in flight, then "Reply as" another post: the new target survives the success', async () => {
    const pending = deferredPublish()
    const onClearReply = vi.fn()
    const { result, rerender } = renderHook(
      (props: Partial<UseComposeAsPersonaOptions>) =>
        useComposeAsPersona(options({ onClearReply, ...props })),
      { initialProps: {} },
    )
    act(() => result.current.setText('A plain post.'))
    act(() => result.current.publish())

    rerender({ replyTo: REPLY_TARGET })
    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(result.current.status).toBe('success')
    expect(onClearReply).not.toHaveBeenCalled()
  })

  it('a reply in flight, then a DIFFERENT target picked: the first reply\'s success keeps the new one', async () => {
    const pending = deferredPublish()
    const onClearReply = vi.fn()
    const { result, rerender } = renderHook(
      (props: Partial<UseComposeAsPersonaOptions>) =>
        useComposeAsPersona(options({ onClearReply, ...props })),
      { initialProps: { replyTo: REPLY_TARGET } as Partial<UseComposeAsPersonaOptions> },
    )
    act(() => result.current.setText('Answering the first.'))
    act(() => result.current.publish())
    expect(lastBody()?.parentPostId).toBe('post-pio-1')

    rerender({ replyTo: OTHER_TARGET })
    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(onClearReply).not.toHaveBeenCalled()
  })

  it('a reply whose target is still the held one DOES clear it', async () => {
    const pending = deferredPublish()
    const onClearReply = vi.fn()
    const { result } = renderHook(() =>
      useComposeAsPersona(options({ replyTo: REPLY_TARGET, onClearReply })),
    )
    act(() => result.current.setText('Same target.'))
    act(() => result.current.publish())

    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('a target cleared by the route while in flight is not "cleared" again', async () => {
    const pending = deferredPublish()
    const onClearReply = vi.fn()
    const { result, rerender } = renderHook(
      (props: Partial<UseComposeAsPersonaOptions>) =>
        useComposeAsPersona(options({ onClearReply, ...props })),
      { initialProps: { replyTo: REPLY_TARGET } as Partial<UseComposeAsPersonaOptions> },
    )
    act(() => result.current.setText('Cleared mid-flight.'))
    act(() => result.current.publish())

    rerender({})
    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(onClearReply).not.toHaveBeenCalled()
  })
})

describe('useComposeAsPersona — a failure after the composer left the screen is not silent', () => {
  it('restores the draft the explicit close discarded, and raises an error toast', async () => {
    const pending = deferredPublish()
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('Sent just before the dock closed.'))
    act(() => first.result.current.publish())
    // Esc / X on the dock: unmount + the console's explicit discard.
    first.unmount()
    composeAsPersonaDraftStore.discardDraft('ex-live-0001', ACTIVE_PERSONA.id)

    await act(async () => pending.reject(httpError(400, 'media is not yours.')))

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      'Post as @FairhavenWater failed (HTTP 400): media is not yours. Draft restored.',
    )
    expect(toast.warning).not.toHaveBeenCalled()
    // A reopened composer finds the text again.
    const second = renderHook(() => useComposeAsPersona(options()))
    expect(second.result.current.text).toBe('Sent just before the dock closed.')
    expect(second.result.current.awaitingDecision).toBe(false)
  })

  it('does not overwrite a newer draft the controller typed in the meantime', async () => {
    const pending = deferredPublish()
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('The one that was sent.'))
    act(() => first.result.current.publish())
    first.unmount()
    composeAsPersonaDraftStore.discardDraft('ex-live-0001', ACTIVE_PERSONA.id)
    const second = renderHook(() => useComposeAsPersona(options()))
    act(() => second.result.current.setText('A newer draft.'))

    await act(async () => pending.reject(httpError(429, { error: 'rate_limited' })))

    expect(toast.error).toHaveBeenCalledTimes(1)
    second.unmount()
    const third = renderHook(() => useComposeAsPersona(options()))
    expect(third.result.current.text).toBe('A newer draft.')
  })

  it('an UNCONFIRMED outcome says "status unknown - check the feed" and comes back gated', async () => {
    const pending = deferredPublish()
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('Maybe out.'))
    act(() => first.result.current.publish())
    first.unmount()

    await act(async () => pending.reject(httpError(504, undefined)))

    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.warning).mock.calls[0]?.[0]).toBe(
      'Post as @FairhavenWater: status unknown - check the feed. Draft restored.',
    )
    expect(toast.error).not.toHaveBeenCalled()
    const second = renderHook(() => useComposeAsPersona(options()))
    expect(second.result.current.text).toBe('Maybe out.')
    expect(second.result.current.awaitingDecision).toBe(true)
  })

  it('also covers a persona switch (still mounted, but another persona is on screen)', async () => {
    const pending = deferredPublish()
    const { result, rerender } = renderHook(
      ({ persona }) => useComposeAsPersona(options({ activePersona: persona })),
      { initialProps: { persona: ACTIVE_PERSONA as StaffPersona } },
    )
    act(() => result.current.setText('For Fairhaven Water.'))
    act(() => result.current.publish())
    rerender({ persona: OTHER_PERSONA })

    await act(async () => pending.reject(httpError(403, 'Exercise is not live.')))

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/^Post as @FairhavenWater failed/)
    // The persona on screen is untouched: no banner, no text.
    expect(result.current.status).toBe('idle')
    expect(result.current.failure).toBeUndefined()
    expect(result.current.text).toBe('')
  })

  it('a SUCCESS after unmount raises no toast, and still reports the post', async () => {
    const pending = deferredPublish()
    const onPublished = vi.fn<(post: Post) => void>()
    const first = renderHook(() => useComposeAsPersona(options({ onPublished })))
    act(() => first.result.current.setText('Went out fine.'))
    act(() => first.result.current.publish())
    first.unmount()

    await act(async () => pending.resolve(PUBLISHED_VIEW))

    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('an on-screen failure raises NO toast (the banner is the signal)', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(400, 'nope.'))
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Watched.'))
    await act(async () => result.current.publish())

    expect(result.current.status).toBe('error')
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('useComposeAsPersona — in-flight bookkeeping is per target', () => {
  it('persona A\'s response does not unlock persona B\'s request that is still in flight', async () => {
    const pendingA = deferredPublish()
    const pendingB = deferredPublish()
    const { result, rerender } = renderHook(
      ({ persona }) => useComposeAsPersona(options({ activePersona: persona })),
      { initialProps: { persona: ACTIVE_PERSONA as StaffPersona } },
    )
    act(() => result.current.setText('For A.'))
    act(() => result.current.publish())
    rerender({ persona: OTHER_PERSONA })
    act(() => result.current.setText('For B.'))
    act(() => result.current.publish())
    expect(publishPost).toHaveBeenCalledTimes(2)

    await act(async () => pendingA.resolve(PUBLISHED_VIEW))
    // B is still waiting: pressing Post again must not send a duplicate.
    act(() => result.current.publish())
    expect(publishPost).toHaveBeenCalledTimes(2)

    await act(async () => pendingB.resolve(PUBLISHED_VIEW))
    expect(result.current.status).toBe('success')
  })
})

describe('useComposeAsPersona — the draft SURVIVES an unmount (Gate-1 WR-103)', () => {
  it('typing a draft, unmounting (e.g. the console closes the dock for an unrelated reason), and remounting for the SAME persona restores the exact text', () => {
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('Boil-water notice lifted for Zone 3.'))
    expect(first.result.current.text).toBe('Boil-water notice lifted for Zone 3.')

    // Simulates ControllerConsole unmounting <PersonaComposer> for a reason
    // that is NOT the operator choosing to discard their text (e.g. the
    // ENGINE settings tool activating and closing the persona dock).
    first.unmount()

    const second = renderHook(() => useComposeAsPersona(options()))
    expect(second.result.current.text).toBe('Boil-water notice lifted for Zone 3.')
  })

  it('a successful publish clears the persisted draft too, so a later remount for the SAME persona starts empty', async () => {
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('Sent already.'))
    await act(async () => first.result.current.publish())
    expect(publishPost).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook(() => useComposeAsPersona(options()))
    expect(second.result.current.text).toBe('')
  })

  it('a DIFFERENT persona never observes another persona\'s in-progress draft', () => {
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('Only for Fairhaven Water.'))
    first.unmount()

    const second = renderHook(() => useComposeAsPersona(options({ activePersona: OTHER_PERSONA })))
    expect(second.result.current.text).toBe('')
  })

  it('discardDraft() removes a persisted draft directly (the primitive ControllerConsole\'s explicit Esc/X close calls) — a no-op if there was none', () => {
    const first = renderHook(() => useComposeAsPersona(options()))
    act(() => first.result.current.setText('About to be explicitly dismissed.'))
    first.unmount()

    composeAsPersonaDraftStore.discardDraft('ex-live-0001', ACTIVE_PERSONA.id)

    const second = renderHook(() => useComposeAsPersona(options()))
    expect(second.result.current.text).toBe('')

    // No-op when there is nothing to discard.
    expect(() => composeAsPersonaDraftStore.discardDraft('ex-live-0001', 'no-such-persona'))
      .not.toThrow()
  })
})

describe('useComposeAsPersona — nothing the controller does in the first frame is wiped by mounting', () => {
  // A passive effect can run a frame AFTER the DOM is on screen, so a file picked, a baseline typed
  // or a post sent in that window must survive it. (The mount-time "re-seed and clear the tray"
  // effect used to empty the tray then: PersonaComposer.upload / .v2 flaked at ~50% under CPU
  // load. A layout effect runs BEFORE every passive effect, which makes the window deterministic.)
  it('keeps a file picked, and a baseline typed, before the mount effects run', () => {
    const { result } = renderHook(() => {
      const compose = useComposeAsPersona(options())
      const acted = useRef(false)
      useLayoutEffect(() => {
        if (acted.current) return
        acted.current = true
        compose.tray.addFiles([new File(['x'], 'early.png', { type: 'image/png' })])
        compose.setBaselineField('like', '12')
        compose.setText('typed early')
      })
      return compose
    })

    expect(result.current.tray.items.map(item => item.name)).toEqual(['early.png'])
    expect(result.current.baselineFields.like).toBe('12')
    expect(result.current.text).toBe('typed early')
  })

  it('still adopts the new target\'s state when the TARGET changes (persona switch)', () => {
    const { result, rerender } = renderHook(
      ({ persona }) => useComposeAsPersona(options({ activePersona: persona })),
      { initialProps: { persona: ACTIVE_PERSONA } },
    )
    act(() => result.current.setText('for the first persona'))
    act(() => {
      result.current.tray.addFiles([new File(['x'], 'a.png', { type: 'image/png' })])
      result.current.setBaselineField('like', '3')
    })
    expect(result.current.tray.items).toHaveLength(1)

    rerender({ persona: OTHER_PERSONA })

    expect(result.current.text).toBe('')
    expect(result.current.tray.items).toHaveLength(0)
    expect(result.current.baselineFields.like).toBe('')
  })
})
