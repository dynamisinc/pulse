/**
 * features/controller/hooks/useComposeAsPersona.mock.test.ts
 * ---------------------------------------------------------------------------
 * The controller persona-compose hook in MOCK mode (`USE_MOCK_DATA` is true under
 * Vitest; demo-polish C1, story 17). The mock path is the SYNCHRONOUS local
 * `createPost` pipeline:
 *  - a publish completes in the same tick (`onPublished` fires, status 'success'), and
 *    emits exactly ONE XC-004 event - `post`, or `reply` carrying `parentPostId` (the
 *    live path emits none from the client: see `useComposeAsPersona.test.ts`);
 *  - a thing the server would 400 (here: a media id the mock registry does not know)
 *    surfaces as a visible, classified error and keeps the whole draft - never success;
 *  - the baseline seeds the post's counts;
 *  - replies and media resolve through the mock registry / store like the real thing.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { registerMockMedia, resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import type { StaffMediaAssetView } from '@/core/media'
import type { StaffPersona } from '@/features/personas'
import type { Post, ReplyTarget } from '@/features/social'
import { composeAsPersonaDraftStore, useComposeAsPersona } from './useComposeAsPersona'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-mock-0001',
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

const REPLY_TARGET: ReplyTarget = {
  postId: 'post-pio-1',
  authorHandle: 'pio_jones',
  authorDisplayName: 'PIO Jones',
  excerpt: 'Is the water safe to drink?',
}

const REGISTERED: StaffMediaAssetView = {
  id: 'mock-media-registered',
  kind: 'image',
  url: '/mock-media/photos/water-plant.svg',
  fileName: 'water-plant.svg',
  uploadedAtScenario: '2033-09-04T12:20:00.000Z',
}

function scope(): ExerciseScope {
  return {
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Mock exercise',
    timeZone: 'America/New_York',
    status: 'active',
  }
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue(scope())
  resetTelemetryBuffer()
  resetMockMediaRegistry()
  registerMockMedia(REGISTERED)
  composeAsPersonaDraftStore.resetForTests()
})

describe('useComposeAsPersona (MOCK) — synchronous local publish', () => {
  it('publishes in the same tick: onPublished fires, status is success, ONE post event is emitted', () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = renderHook(() =>
      useComposeAsPersona({ activePersona: PERSONA, actingHumanId: 'human-ctl-7', onPublished }),
    )
    act(() => result.current.setText('Zones 2-4 are clear.'))

    act(() => result.current.publish())

    expect(result.current.status).toBe('success')
    expect(result.current.text).toBe('')
    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished.mock.calls[0]?.[0]).toMatchObject({
      text: 'Zones 2-4 are clear.',
      origin: 'controller-as-persona',
      actingHumanId: 'human-ctl-7',
    })
    const events = getEmittedTelemetryEvents()
    expect(events.map(event => event.eventType)).toEqual(['post'])
    expect(events[0]?.origin).toBe('controller-as-persona')
  })

  it('a reply carries parentPostId, emits ONE reply event with it, and asks the route to clear the target', () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const onClearReply = vi.fn()
    const { result } = renderHook(() =>
      useComposeAsPersona({
        activePersona: PERSONA,
        actingHumanId: 'human-ctl-7',
        onPublished,
        replyTo: REPLY_TARGET,
        onClearReply,
      }),
    )
    act(() => result.current.setText('The advisory is lifted for Zone 3.'))

    act(() => result.current.publish())

    expect(onPublished.mock.calls[0]?.[0]?.parentPostId).toBe('post-pio-1')
    expect(onClearReply).toHaveBeenCalledTimes(1)
    const events = getEmittedTelemetryEvents()
    expect(events.map(event => event.eventType)).toEqual(['reply'])
    expect(events[0]?.payload).toEqual({ parentPostId: 'post-pio-1' })
  })

  it('seeds the post\'s counts from the baseline', () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = renderHook(() =>
      useComposeAsPersona({ activePersona: PERSONA, actingHumanId: 'human-ctl-7', onPublished }),
    )
    act(() => result.current.setText('Trending.'))
    act(() => result.current.setBaselineField('like', '2300'))
    act(() => result.current.setBaselineField('repost', '340'))
    act(() => result.current.setBaselineField('reply', '86'))

    act(() => result.current.publish())

    expect(onPublished.mock.calls[0]?.[0]?.counts)
      .toMatchObject({ like: 2300, repost: 340, reply: 86 })
  })

  it('attaches described media resolved through the mock registry', () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { result } = renderHook(() =>
      useComposeAsPersona({ activePersona: PERSONA, actingHumanId: 'human-ctl-7', onPublished }),
    )
    act(() => result.current.tray.setLibrarySelection([REGISTERED.id], () => REGISTERED))
    act(() => result.current.tray.setAlt(result.current.tray.items[0]?.key ?? '', 'The plant'))

    act(() => result.current.publish())

    expect(onPublished.mock.calls[0]?.[0]?.media).toMatchObject([
      { id: 'mock-media-registered', kind: 'image', alt: 'The plant' },
    ])
  })
})

describe('useComposeAsPersona (MOCK) — a refusal is visible, never a false success', () => {
  it('shows the mock\'s 400-equivalent, keeps the whole draft and emits nothing', () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const onClearReply = vi.fn()
    const ghost: StaffMediaAssetView = { ...REGISTERED, id: 'mock-media-not-registered' }
    const { result } = renderHook(() =>
      useComposeAsPersona({
        activePersona: PERSONA,
        actingHumanId: 'human-ctl-7',
        onPublished,
        replyTo: REPLY_TARGET,
        onClearReply,
      }),
    )
    act(() => result.current.setText('This will be refused.'))
    act(() => result.current.tray.setLibrarySelection([ghost.id], () => ghost))
    act(() => result.current.tray.setAlt(result.current.tray.items[0]?.key ?? '', 'Ghost'))

    act(() => result.current.publish())

    expect(result.current.status).toBe('error')
    expect(result.current.failure).toMatchObject({
      kind: 'rejected',
      message: expect.stringMatching(/not available/),
    })
    // The banner reads as a message, not as an engineering stack fragment.
    expect(result.current.failure?.message).toBe('that media attachment is not available.')
    expect(result.current.failure?.message).not.toMatch(/createPost/)
    expect(result.current.lastPublished).toBeNull()
    expect(onPublished).not.toHaveBeenCalled()
    expect(onClearReply).not.toHaveBeenCalled()
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
    expect(result.current.text).toBe('This will be refused.')
    expect(result.current.tray.items).toHaveLength(1)

    // Retry after fixing the cause (here: the asset now exists) succeeds.
    registerMockMedia({ ...ghost })
    act(() => result.current.publish())
    expect(result.current.status).toBe('success')
    expect(onPublished).toHaveBeenCalledTimes(1)
  })
})
