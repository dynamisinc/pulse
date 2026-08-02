/**
 * features/social/hooks/useFollow.rollback.test.ts
 * ---------------------------------------------------------------------------
 * Covers the optimistic-rollback AC (story 02): a REJECTED
 * `followPersona`/`unfollowPersona` write must roll back BOTH `isFollowing`
 * AND `followerCount` to their pre-toggle values — a failed write must never
 * leave the button showing "Following" (or the count bumped) when the server
 * never recorded the edge. Lives in its own file so its `followService` mock
 * can reject without affecting the sibling success-path spec
 * (`useFollow.test.ts`).
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
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
  vi.mocked(followPersona).mockRejectedValue(new Error('server refused'))
  vi.mocked(unfollowPersona).mockRejectedValue(new Error('server refused'))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFollow — optimistic rollback on a failed write', () => {
  it('rolls back isFollowing + followerCount when following fails', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 42 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())

    // Optimistic state applied immediately.
    expect(result.current.isFollowing).toBe(true)
    expect(result.current.followerCount).toBe(43)

    // The rejection rolls both back once the write settles.
    await waitFor(() => expect(result.current.isFollowing).toBe(false))
    expect(result.current.followerCount).toBe(42)
    expect(result.current.pending).toBe(false)
  })

  it('rolls back an unfollow rejection too, restoring the followed state + count', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 42, initiallyFollowing: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())

    expect(result.current.isFollowing).toBe(false)
    expect(result.current.followerCount).toBe(41)

    await waitFor(() => expect(result.current.isFollowing).toBe(true))
    expect(result.current.followerCount).toBe(42)
    expect(result.current.pending).toBe(false)
  })

  it('allows a retry toggle after a rollback (pending is cleared, not stuck)', async () => {
    const { result } = renderHook(
      () => useFollow({ personaId: 'persona-x', initialFollowerCount: 10 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.isFollowing).toBe(false)

    // A second attempt, now succeeding, must still be possible. Resolves with
    // the server's authoritative envelope — `following: true`, and `changed:
    // true` because this write is what created the edge (SG-001).
    vi.mocked(followPersona).mockResolvedValueOnce({ following: true, changed: true })
    act(() => result.current.toggleFollow())
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.isFollowing).toBe(true)
    expect(result.current.followerCount).toBe(11)
  })
})

/**
 * The OTHER half of the settle guard: it must still ABANDON a write whose target
 * changed mid-flight. This is the behaviour `requestTokenRef` exists for, and it
 * had no test — so the fix that stopped the guard firing on MOUNT (see
 * `useFollow.ts`) could have disabled it outright with the suite still green.
 */
describe('useFollow — a write abandoned by a target change must not settle onto the new target', () => {
  it('does not roll back onto the NEW persona when the OLD persona\'s write fails late', async () => {
    let rejectWrite: (() => void) | undefined
    vi.mocked(followPersona).mockImplementation(
      () => new Promise<never>((_, reject) => {
        rejectWrite = () => reject(new Error('server refused, late'))
      }),
    )

    const { result, rerender } = renderHook(
      ({ id, count }: { id: string; count: number }) =>
        useFollow({ personaId: id, initialFollowerCount: count }),
      { wrapper, initialProps: { id: 'persona-a', count: 10 } },
    )
    await waitFor(() => expect(result.current.canFollow).toBe(true))

    act(() => result.current.toggleFollow())
    expect(result.current.isFollowing).toBe(true)
    expect(result.current.followerCount).toBe(11)

    // Re-point at a DIFFERENT persona while A's write is still in flight.
    rerender({ id: 'persona-b', count: 900 })
    expect(result.current.followerCount).toBe(900)

    // A's write now fails. Its rollback targets A's pre-toggle count (10) — if the
    // guard let it through, B's count would be clobbered to 10. The count, not
    // `isFollowing`, is the discriminating signal here: B's reset already put
    // `isFollowing` at false, so that alone cannot tell the two outcomes apart.
    expect(rejectWrite).toBeDefined()
    await act(async () => {
      rejectWrite?.()
      await Promise.resolve()
    })

    expect(result.current.followerCount).toBe(900)
    expect(result.current.isFollowing).toBe(false)
  })
})
