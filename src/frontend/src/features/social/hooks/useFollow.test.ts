/**
 * features/social/hooks/useFollow.test.ts
 * ---------------------------------------------------------------------------
 * Covers story-02 ACs for the follow/unfollow hook (SOC-051, COR-001):
 *   - `useFollow` seeds the count/own-state, then `toggleFollow` follows then
 *     unfollows — the count moves ±1, `isFollowing` reflects the viewer's own
 *     state, and the correct `followService` write is called with the TARGET
 *     persona id;
 *   - `initiallyFollowing` seeds an already-followed account;
 *   - no client-side telemetry is emitted — the server is the sole XC-004
 *     emitter for a follow/unfollow state change;
 *   - a second `toggleFollow()` call while a write is in flight is a no-op
 *     (prevents two overlapping optimistic mutations racing each other).
 *
 * (The observer/no-persona "control absent" ACs — COR-015/D1-011 — live in
 * the sibling `useFollow.readonly.test.ts` / `useFollow.noPersona.test.ts`,
 * which mock a read-only / personaless session. Rollback-on-failure lives in
 * `useFollow.rollback.test.ts`.)
 *
 * Runs through the REAL `SessionProvider` (resolves via the shared axios
 * client's built-in dev mock adapter, exactly as the shipped app does —
 * mirrors `useReaction.test.ts`), with `followService` mocked so no toggle
 * here depends on the mock adapter's own in-memory edge state.
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useFollow } from './useFollow'
import { followPersona, unfollowPersona } from '../services/followService'

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
}))

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SessionProvider, null, children)
}

beforeEach(() => {
  resetTelemetryBuffer()
  vi.mocked(followPersona).mockResolvedValue(undefined)
  vi.mocked(unfollowPersona).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFollow — follow/unfollow + optimistic count (SOC-051)', () => {
  it('seeds state, then follows: count +1, isFollowing true, calls followPersona with the target id', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-fairhavenwater', initialFollowerCount: 120 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.canFollow).toBe(true))
    expect(result.current.followerCount).toBe(120)
    expect(result.current.isFollowing).toBe(false)

    act(() => result.current.toggleFollow())

    // Optimistic update is synchronous.
    expect(result.current.isFollowing).toBe(true)
    expect(result.current.followerCount).toBe(121)

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(followPersona).toHaveBeenCalledWith('persona-fairhavenwater')
    expect(unfollowPersona).not.toHaveBeenCalled()
  })

  it('unfollows on a second toggle: count back to the seed, calls unfollowPersona', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-fairhavenwater', initialFollowerCount: 120 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())
    await waitFor(() => expect(result.current.pending).toBe(false))

    act(() => result.current.toggleFollow())
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(result.current.isFollowing).toBe(false)
    expect(result.current.followerCount).toBe(120)
    expect(unfollowPersona).toHaveBeenCalledWith('persona-fairhavenwater')
  })

  it('honors initiallyFollowing (an already-followed account): unfollowing drops the count', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 10, initiallyFollowing: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))
    expect(result.current.isFollowing).toBe(true)

    act(() => result.current.toggleFollow())

    expect(result.current.followerCount).toBe(9)
    expect(result.current.isFollowing).toBe(false)
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(unfollowPersona).toHaveBeenCalledWith('persona-x')
  })

  it('clamps the count at 0 rather than rendering negative', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 0, initiallyFollowing: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())

    expect(result.current.followerCount).toBe(0)
  })

  it('emits no client-side telemetry (the server is the sole XC-004 emitter for follow state changes)', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 5 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('ignores a second toggleFollow() call while the first write is still pending', async () => {
    let releaseWrite: (() => void) | undefined
    vi.mocked(followPersona).mockImplementation(
      () => new Promise<void>(resolve => { releaseWrite = resolve }),
    )

    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 5 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())
    expect(result.current.pending).toBe(true)

    // A stray second activation while pending must not fire another write or
    // flip state again.
    act(() => result.current.toggleFollow())
    expect(followPersona).toHaveBeenCalledTimes(1)
    expect(result.current.isFollowing).toBe(true)
    expect(result.current.followerCount).toBe(6)

    await act(async () => {
      releaseWrite?.()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.pending).toBe(false))
  })
})
