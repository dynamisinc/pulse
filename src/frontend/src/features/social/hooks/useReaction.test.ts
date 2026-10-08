/**
 * features/social/hooks/useReaction.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-01 ACs for the like/unlike hook (SOC-030, XC-004, COR-001,
 * COR-053):
 *   - `buildLikeTelemetryInput` (pure) assembles a well-formed XC-004
 *     `'reaction'` envelope input — persona actor (COR-018), `social` channel,
 *     participant origin, the post target, and a `{reaction:'like', liked}`
 *     payload that distinguishes an add from a remove;
 *   - `useReaction` seeds the count/own-state, and `toggleLike` likes then
 *     unlikes — the count moves ±1, `likedByViewer` reflects the viewer's own
 *     state, and each confirmed toggle emits exactly ONE `'reaction'` event
 *     (mock mode) stamped with the injected SCENARIO instant (never wall-clock);
 *   - `initiallyLiked` seeds an already-liked post.
 *
 * (The observer-mode "like control is ABSENT" AC — COR-015/D1-011 — lives in
 * the sibling `useReaction.readonly.test.ts`, which mocks a read-only session;
 * the shared Wave-1 mock session here is a normal, writable participant.)
 *
 * Runs through the REAL `ExerciseContextProvider` + `SessionProvider` (both
 * resolve via the shared axios client's built-in dev mock adapters, exactly as
 * the shipped app does — mirrors `Composer.test.tsx`), with a fixed exercise
 * clock so the stamped scenario instant is deterministic.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { resetMockReactions, setMockReactionFailure } from '../services/reactionService'
import { buildLikeTelemetryInput, useReaction } from './useReaction'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ExerciseContextProvider,
    null,
    createElement(SessionProvider, null, children),
  )
}

function reactionEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'reaction')
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockReactions()
})

afterEach(() => {
  resetExerciseClock()
  resetMockReactions()
})

describe('buildLikeTelemetryInput (XC-004 reaction envelope)', () => {
  it('assembles a persona-attributed like event targeting the post', () => {
    const input = buildLikeTelemetryInput({
      exerciseId: 'ex-mock-0001',
      timeZone: 'America/Chicago',
      scenarioTime: '2033-09-04T13:15:00.000Z',
      wallClockTime: '2026-07-21T10:00:00.000Z',
      personaId: 'persona-dreyes_fh',
      actingHumanId: 'human-dreyes',
      postId: 'post-seed-fw-advisory',
      liked: true,
    })

    expect(input.eventType).toBe('reaction')
    expect(input.channel).toBe('social')
    expect(input.origin).toBe('participant')
    // A like is a participant action performed AS their persona (COR-018).
    expect(input.actor.kind).toBe('persona')
    expect(input.actor.personaId).toBe('persona-dreyes_fh')
    expect(input.actor.actingHumanId).toBe('human-dreyes')
    expect(input.target).toEqual({ entityType: 'post', entityId: 'post-seed-fw-advisory' })
    expect(input.payload).toEqual({ reaction: 'like', liked: true })
    // COR-001: exerciseId stamps the envelope.
    expect(input.exerciseId).toBe('ex-mock-0001')
  })

  it('flags an unlike via payload.liked = false', () => {
    const input = buildLikeTelemetryInput({
      exerciseId: 'ex-mock-0001',
      timeZone: 'America/Chicago',
      scenarioTime: '2033-09-04T13:15:00.000Z',
      wallClockTime: '2026-07-21T10:00:00.000Z',
      personaId: 'persona-dreyes_fh',
      actingHumanId: 'human-dreyes',
      postId: 'post-seed-fw-advisory',
      liked: false,
    })
    expect(input.payload).toEqual({ reaction: 'like', liked: false })
  })
})

describe('useReaction — like/unlike + count + own state (SOC-030)', () => {
  it('seeds the count and own-state, then likes: count +1, likedByViewer true', async () => {
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))
    const { result } = renderHook(
      () => useReaction({ postId: 'post-seed-fw-advisory', initialLikeCount: 76 }),
      { wrapper },
    )

    // Wait for the providers to resolve and the hook to mount.
    await waitFor(() => expect(result.current.canReact).toBe(true))

    expect(result.current.likeCount).toBe(76)
    expect(result.current.likedByViewer).toBe(false)
    expect(result.current.isReadOnly).toBe(false)

    act(() => result.current.toggleLike())

    // Optimistic: applied synchronously, before the write settles.
    expect(result.current.likeCount).toBe(77)
    expect(result.current.likedByViewer).toBe(true)

    // Mock mode: ONE event per confirmed toggle, emitted when the write resolves.
    await waitFor(() => expect(reactionEvents()).toHaveLength(1))
    const events = reactionEvents()
    expect(events[0]?.channel).toBe('social')
    expect(events[0]?.actor.kind).toBe('persona')
    expect(events[0]?.actor.personaId).toBe('persona-dreyes_fh')
    expect(events[0]?.target).toEqual({ entityType: 'post', entityId: 'post-seed-fw-advisory' })
    expect(events[0]?.payload).toEqual({ reaction: 'like', liked: true })
    // Scenario time only — the injected clock instant, never wall-clock.
    expect(events[0]?.scenarioTime).toBe('2031-03-01T14:00:00.000Z')
  })

  it('unlikes on a second toggle: count back to the seed, own-state false, one more event', async () => {
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))
    const { result } = renderHook(
      () => useReaction({ postId: 'post-seed-fw-advisory', initialLikeCount: 76 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canReact).toBe(true))

    act(() => result.current.toggleLike())
    await waitFor(() => expect(result.current.pending).toBe(false))
    act(() => result.current.toggleLike())
    await waitFor(() => expect(reactionEvents()).toHaveLength(2))

    expect(result.current.likeCount).toBe(76)
    expect(result.current.likedByViewer).toBe(false)

    const events = reactionEvents()
    expect(events[1]?.payload).toEqual({ reaction: 'like', liked: false })
  })

  it('honors initiallyLiked (an already-liked post): unliking drops the count', async () => {
    const { result } = renderHook(
      () => useReaction({ postId: 'post-x', initialLikeCount: 10, initiallyLiked: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canReact).toBe(true))

    expect(result.current.likedByViewer).toBe(true)

    act(() => result.current.toggleLike())

    expect(result.current.likeCount).toBe(9)
    expect(result.current.likedByViewer).toBe(false)
  })
})

describe('useReaction — failed write (rollback, F3)', () => {
  it('reverts the count and own-state exactly, surfaces the message, emits no event', async () => {
    const { result } = renderHook(
      () => useReaction({ postId: 'post-fail', initialLikeCount: 76 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canReact).toBe(true))

    setMockReactionFailure(true)
    act(() => result.current.toggleLike())
    expect(result.current.likeCount).toBe(77)
    expect(result.current.likedByViewer).toBe(true)

    await waitFor(() => expect(result.current.errorMessage).toMatch(/couldn't update your like/i))
    expect(result.current.likeCount).toBe(76)
    expect(result.current.likedByViewer).toBe(false)
    expect(result.current.pending).toBe(false)
    expect(reactionEvents()).toHaveLength(0)
  })

  it('a second tap while the first write is pending is a no-op (no double count)', async () => {
    const { result } = renderHook(
      () => useReaction({ postId: 'post-dbl', initialLikeCount: 76 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canReact).toBe(true))

    act(() => {
      result.current.toggleLike()
      result.current.toggleLike()
    })

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.likeCount).toBe(77)
    expect(result.current.likedByViewer).toBe(true)
    expect(reactionEvents()).toHaveLength(1)
  })
})
