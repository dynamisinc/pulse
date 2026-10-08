/**
 * features/social/hooks/useReactionToggle.live.test.ts
 * ---------------------------------------------------------------------------
 * LIVE mode (`USE_MOCK_DATA` forced false; demo-polish F3, implementation.md §1.8):
 * the server emits the XC-004 `reaction` / `repost` events, so the client's
 * mock-telemetry callback must NEVER run — not on a confirmed toggle, not on an
 * undo. (The mock-mode counterpart, "exactly once per confirmed change", is in
 * `useReactionToggle.test.ts`.) Own file: the `mockData` mock is hoisted over the
 * whole module.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteReaction, putReaction, type ReactionState } from '../services/reactionService'
import { useReactionToggle } from './useReactionToggle'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('../services/reactionService', () => ({
  putReaction: vi.fn(),
  deleteReaction: vi.fn(),
  mockReactionSnapshot: vi.fn(() => ({ active: true, count: 999 })),
}))

function body(active: boolean, count: number): ReactionState {
  return {
    postId: 'post-1',
    kind: 'like',
    active,
    counts: { reply: 0, like: count, repost: 0 },
    viewer: { liked: active, reposted: false },
  }
}

beforeEach(() => {
  vi.mocked(putReaction).mockReset()
  vi.mocked(deleteReaction).mockReset()
})

describe('useReactionToggle (live) — zero client telemetry', () => {
  it('never calls the mock telemetry callback, on like or on unlike', async () => {
    vi.mocked(putReaction).mockResolvedValue(body(true, 11))
    vi.mocked(deleteReaction).mockResolvedValue(body(false, 10))
    const emitMockTelemetry = vi.fn()
    const { result } = renderHook(() =>
      useReactionToggle({
        postId: 'post-1',
        kind: 'like',
        initialCount: 10,
        initiallyActive: false,
        canAct: true,
        failureMessage: 'x',
        emitMockTelemetry,
      }),
    )

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.count).toBe(11))
    // Settled (not merely reconciled): the success callback — where a mock-mode emit
    // would live — has certainly run before we assert it never fired.
    await waitFor(() => expect(result.current.pending).toBe(false))
    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.count).toBe(10))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(emitMockTelemetry).not.toHaveBeenCalled()
  })

  it('ignores the mock adapter\'s remembered state — the post\'s own viewer flags seed it', () => {
    const { result } = renderHook(() =>
      useReactionToggle({
        postId: 'post-1',
        kind: 'like',
        initialCount: 10,
        initiallyActive: false,
        canAct: true,
        failureMessage: 'x',
        emitMockTelemetry: vi.fn(),
      }),
    )

    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(10)
  })
})
