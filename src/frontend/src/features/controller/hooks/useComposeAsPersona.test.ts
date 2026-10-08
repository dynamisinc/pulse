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
import { act, renderHook } from '@testing-library/react'
import { AxiosError } from 'axios'
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
  const promise = new Promise<CreatedPostView>(res => {
    resolve = res
  })
  vi.mocked(publishPost).mockReturnValueOnce(promise)
  return { resolve }
}

/** The body most recently handed to `publishPost`. */
function lastBody() {
  const calls = vi.mocked(publishPost).mock.calls
  return calls[calls.length - 1]?.[0]
}

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scope())
  vi.mocked(publishPost).mockReset().mockResolvedValue(PUBLISHED_VIEW)
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

  it('a network failure is "failed" (retry is reasonable); an unreadable 2xx is "unconfirmed"', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
    const { result } = renderHook(() => useComposeAsPersona(options()))
    act(() => result.current.setText('Offline.'))
    await act(async () => result.current.publish())
    expect(result.current.failure?.kind).toBe('failed')

    vi.mocked(publishPost).mockRejectedValueOnce(
      new Error('publishPost: the server returned a malformed post'),
    )
    await act(async () => result.current.publish())
    expect(result.current.failure?.kind).toBe('unconfirmed')
    expect(result.current.status).toBe('error')
    expect(result.current.text).toBe('Offline.')
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
