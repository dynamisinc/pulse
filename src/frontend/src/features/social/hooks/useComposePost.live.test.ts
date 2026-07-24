/**
 * features/social/hooks/useComposePost.live.test.ts
 * ---------------------------------------------------------------------------
 * The LIVE branch of the UAT compose fix (`publish()`'s `USE_MOCK_DATA` flip
 * in `useComposePost.ts`; SOC-001, COR-001, COR-053):
 *  - LIVE mode fires `livePostActions.publishPost` with the mapped
 *    `CreatePostInput` (`origin: 'participant'`), fire-and-forget;
 *  - it does NOT call `createPost` (no double telemetry) and does NOT call
 *    `onPosted` (no locally-created `Post` to hand back, and no optimistic
 *    insert the feed's persona-cast resolution would drop anyway);
 *  - the draft still clears on publish, same as mock mode;
 *  - a rejected `publishPost` never surfaces as an unhandled rejection (the
 *    documented CI-teardown-race hazard) — the hook's own `.catch(() => {})`
 *    covers it.
 *
 * This lives in its own file — mirrors `useReaction.readonly.test.ts`'s own
 * rationale — because `vi.mock('@/core/config/mockData', ...)` is hoisted to
 * the WHOLE module: forcing `USE_MOCK_DATA` false here would also flip the
 * frozen mock/live constants inside `exerciseContextResolver.ts` /
 * `sessionResolver.ts` (WAVE0-REVIEW precedent 15), breaking the REAL
 * `ExerciseContextProvider` / `SessionProvider` the sibling `useComposePost.
 * test.ts` relies on. So this file bypasses both providers entirely by
 * mocking `useExerciseContext()` / `useSession()` directly (mirrors
 * `useEngineControl.test.ts`), needing no provider tree at all.
 *
 * `../services/postService`'s mock is a FLAT factory (no `importOriginal()`
 * spread — see `useFeed.race.test.ts`'s header for the same Vitest-4.1.10
 * gotcha this sidesteps: an async factory that calls `importOriginal()` here
 * was found to leave `useComposePost.ts`'s own `createPost` import bound to
 * the REAL implementation instead of the stub).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import type { Session } from '@/core/auth'
import type { Post } from '@/features/social'
import { useComposePost } from './useComposePost'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('@/core/auth', () => ({
  useSession: vi.fn(),
}))

// Mock the CONCRETE `postService` module (not the whole `@/features/social`
// barrel — that would pull in `Feed`/`Composer`/`SocialChannel` and their own
// heavy dependency graphs just to stub one function). The barrel re-exports
// `createPost` from this exact module path, so `useComposePost.ts`'s barrel
// import sees the same mock. `listPosts` MUST still resolve to a real array
// — `postStore.ts` calls it at MODULE TOP LEVEL (`let posts = listPosts()`),
// and the barrel's full evaluation pulls `postStore.ts` in transitively via
// `Feed`/`feedService`, even though this test only renders the bare hook.
// `toParticipantView`/`originConsoleLabel` are stubbed too, defensively —
// nothing in this test's path calls them, but a future addition shouldn't
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

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scope())
  mockedUseSession.mockReturnValue(writableSession())
  vi.mocked(publishPost).mockReset().mockResolvedValue(undefined)
  vi.mocked(createPost).mockClear()
})

describe('useComposePost — LIVE mode publish() (UAT compose fix)', () => {
  it('fires livePostActions.publishPost with the mapped input; never calls createPost/onPosted', async () => {
    const onPosted = vi.fn<(post: Post) => void>()
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
    // No client exerciseId leaks into the *input the hook builds* getting
    // dropped is livePostActions' job (covered in its own test); this hook
    // still stamps `exerciseId` for the input shape, so assert it's present
    // here (stamping-only, COR-001) rather than asserting its absence.
    const publishedInput = vi.mocked(publishPost).mock.calls[0]?.[0]
    expect(publishedInput?.exerciseId).toBe('ex-live-0001')

    expect(createPost).not.toHaveBeenCalled()
    expect(onPosted).not.toHaveBeenCalled()

    // Draft still clears.
    expect(result.current.text).toBe('')
  })

  it('a rejected publishPost never becomes an unhandled rejection', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useComposePost())

    act(() => result.current.setText('Fire and forget.'))
    expect(() => act(() => result.current.publish())).not.toThrow()

    await waitFor(() => expect(publishPost).toHaveBeenCalledTimes(1))
  })
})
