/**
 * features/social/hooks/useReactionToggle.test.ts
 * ---------------------------------------------------------------------------
 * The shared persisted-toggle engine behind the like and repost controls
 * (demo-polish F3; SOC-030, SOC-020/021, NFR-001). `reactionService` is mocked so
 * every request is a promise the test controls — that is what makes the ordering
 * claims checkable:
 *
 *  - OPTIMISTIC: the flip and the ±1 land synchronously, before the write settles;
 *  - RECONCILE: on resolve the server's `viewer` flag and `counts[kind]` win;
 *  - ROLLBACK: on reject BOTH revert exactly and the failure message is shown;
 *  - IN-FLIGHT GUARD: a second `toggle()` while pending (even inside the same tick)
 *    sends no second request, and `pending` is cleared afterwards so a retry works;
 *  - `canAct: false` is a hard no-op (no request);
 *  - MOCK-mode telemetry callback: once per CONFIRMED state change, never for a
 *    rolled-back write and never for an idempotent repeat (the server's rule).
 *
 * (Live mode — the callback is never invoked — is `useReactionToggle.live.test.ts`;
 * the wire itself is `PostActions.live.test.tsx` / `reactionService.test.ts`.)
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteReaction,
  mockReactionSnapshot,
  putReaction,
  type ReactionKind,
  type ReactionState,
} from '../services/reactionService'
import { useReactionToggle, type UseReactionToggleOptions } from './useReactionToggle'

vi.mock('../services/reactionService', () => ({
  putReaction: vi.fn(),
  deleteReaction: vi.fn(),
  mockReactionSnapshot: vi.fn(),
}))

function state(
  kind: ReactionKind,
  active: boolean,
  count: number,
  extra: { liked?: boolean; reposted?: boolean } = {},
): ReactionState {
  return {
    postId: 'post-1',
    kind,
    active,
    counts: { reply: 0, like: kind === 'like' ? count : 5, repost: kind === 'repost' ? count : 5 },
    viewer: {
      liked: extra.liked ?? (kind === 'like' ? active : false),
      reposted: extra.reposted ?? (kind === 'repost' ? active : false),
    },
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<UseReactionToggleOptions> = {}) {
  const emitMockTelemetry = vi.fn()
  const options: UseReactionToggleOptions = {
    postId: 'post-1',
    kind: 'like',
    initialCount: 10,
    initiallyActive: false,
    canAct: true,
    failureMessage: 'It failed.',
    emitMockTelemetry,
    ...overrides,
  }
  const hook = renderHook(() => useReactionToggle(options))
  return { ...hook, emitMockTelemetry }
}

beforeEach(() => {
  vi.mocked(putReaction).mockReset()
  vi.mocked(deleteReaction).mockReset()
  vi.mocked(mockReactionSnapshot).mockReset()
})

describe('useReactionToggle — optimistic then reconciled', () => {
  it('flips and counts +1 immediately, PUTs, then adopts the server\'s answer', async () => {
    const write = deferred<ReactionState>()
    vi.mocked(putReaction).mockReturnValue(write.promise)
    const { result } = setup()

    act(() => result.current.toggle())

    expect(result.current.active).toBe(true)
    expect(result.current.count).toBe(11)
    expect(result.current.pending).toBe(true)
    // The mock-only seed is what the client showed BEFORE the write.
    expect(putReaction).toHaveBeenCalledWith('post-1', 'like', { active: false, count: 10 })

    await act(async () => write.resolve(state('like', true, 14)))

    expect(result.current.active).toBe(true)
    expect(result.current.count).toBe(14)
    expect(result.current.pending).toBe(false)
    expect(result.current.errorMessage).toBeNull()
  })

  it('DELETEs to turn an active reaction off and counts -1 (clamped at 0)', async () => {
    vi.mocked(deleteReaction).mockResolvedValue(state('like', false, 0))
    const { result } = setup({ initialCount: 0, initiallyActive: true })

    act(() => result.current.toggle())

    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(0)
    expect(deleteReaction).toHaveBeenCalledWith('post-1', 'like', { active: true, count: 0 })
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('reads the repost flag for kind "repost" (not the like flag)', async () => {
    vi.mocked(putReaction).mockResolvedValue(state('repost', true, 3, { liked: true }))
    const { result } = setup({ kind: 'repost', initialCount: 2 })

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(result.current.active).toBe(true)
    expect(result.current.count).toBe(3)
  })

  it('the server may say the reaction ended up OFF: the control follows it', async () => {
    vi.mocked(putReaction).mockResolvedValue(state('like', false, 10, { liked: false }))
    const { result } = setup()

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(10)
  })
})

describe('useReactionToggle — rollback', () => {
  it('reverts active and count EXACTLY and shows the failure message', async () => {
    const write = deferred<ReactionState>()
    vi.mocked(putReaction).mockReturnValue(write.promise)
    const { result } = setup({ initialCount: 41 })

    act(() => result.current.toggle())
    expect(result.current.count).toBe(42)

    await act(async () => write.reject(new Error('503')))

    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(41)
    expect(result.current.pending).toBe(false)
    expect(result.current.errorMessage).toBe('It failed.')
  })

  it('rolls an UNDO back to ON with the original count', async () => {
    vi.mocked(deleteReaction).mockRejectedValue(new Error('503'))
    const { result } = setup({ initialCount: 8, initiallyActive: true })

    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(7)

    await waitFor(() => expect(result.current.errorMessage).toBe('It failed.'))
    expect(result.current.active).toBe(true)
    expect(result.current.count).toBe(8)
  })

  it('allows a retry after a rollback (pending is cleared, the guard is released)', async () => {
    vi.mocked(putReaction)
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(state('like', true, 11))
    const { result } = setup()

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.errorMessage).not.toBeNull())

    act(() => result.current.toggle())
    // Trying again clears the old message straight away.
    expect(result.current.errorMessage).toBeNull()
    await waitFor(() => expect(result.current.count).toBe(11))
    expect(result.current.active).toBe(true)
    expect(putReaction).toHaveBeenCalledTimes(2)
  })
})

describe('useReactionToggle — in-flight guard and gating', () => {
  it('two toggles inside ONE tick send one request and count once', async () => {
    const write = deferred<ReactionState>()
    vi.mocked(putReaction).mockReturnValue(write.promise)
    const { result } = setup()

    act(() => {
      result.current.toggle()
      result.current.toggle()
    })

    expect(putReaction).toHaveBeenCalledTimes(1)
    expect(deleteReaction).not.toHaveBeenCalled()
    expect(result.current.count).toBe(11)

    await act(async () => write.resolve(state('like', true, 11)))
    expect(result.current.count).toBe(11)
  })

  it('a toggle while a write is pending is a no-op until it settles', async () => {
    const write = deferred<ReactionState>()
    vi.mocked(putReaction).mockReturnValue(write.promise)
    const { result } = setup()

    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(putReaction).toHaveBeenCalledTimes(1)

    await act(async () => write.resolve(state('like', true, 11)))
    vi.mocked(deleteReaction).mockResolvedValue(state('like', false, 10))
    act(() => result.current.toggle())
    expect(deleteReaction).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('canAct: false is a hard no-op — no request, no state change', () => {
    const { result } = setup({ canAct: false })

    act(() => result.current.toggle())

    expect(putReaction).not.toHaveBeenCalled()
    expect(deleteReaction).not.toHaveBeenCalled()
    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(10)
  })
})

describe('useReactionToggle — mock-mode telemetry callback', () => {
  it('fires ONCE per confirmed state change, with the resulting state, after the write resolves', async () => {
    const write = deferred<ReactionState>()
    vi.mocked(putReaction).mockReturnValue(write.promise)
    const { result, emitMockTelemetry } = setup()

    act(() => result.current.toggle())
    expect(emitMockTelemetry).not.toHaveBeenCalled()

    await act(async () => write.resolve(state('like', true, 11)))
    expect(emitMockTelemetry).toHaveBeenCalledTimes(1)
    expect(emitMockTelemetry).toHaveBeenCalledWith(true)

    vi.mocked(deleteReaction).mockResolvedValue(state('like', false, 10))
    act(() => result.current.toggle())
    await waitFor(() => expect(emitMockTelemetry).toHaveBeenCalledTimes(2))
    expect(emitMockTelemetry).toHaveBeenLastCalledWith(false)
  })

  it('never fires for a rolled-back write', async () => {
    vi.mocked(putReaction).mockRejectedValue(new Error('503'))
    const { result, emitMockTelemetry } = setup()

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.errorMessage).not.toBeNull())

    expect(emitMockTelemetry).not.toHaveBeenCalled()
  })

  it('never fires for an idempotent repeat (the server says nothing changed)', async () => {
    // Showed OFF, but the server already had it OFF... and we asked for ON: it stays OFF.
    vi.mocked(putReaction).mockResolvedValue(state('like', false, 10))
    const { result, emitMockTelemetry } = setup()

    act(() => result.current.toggle())
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(emitMockTelemetry).not.toHaveBeenCalled()
  })
})

describe('useReactionToggle — seeding', () => {
  it('seeds from the options', () => {
    const { result } = setup({ initialCount: 1450, initiallyActive: true })

    expect(result.current.active).toBe(true)
    expect(result.current.count).toBe(1450)
  })

  it('in mock mode the adapter\'s remembered state overrides the post\'s own flags', () => {
    vi.mocked(mockReactionSnapshot).mockReturnValue({ active: true, count: 99 })
    const { result } = setup({ initialCount: 10, initiallyActive: false })

    expect(mockReactionSnapshot).toHaveBeenCalledWith('post-1', 'like')
    expect(result.current.active).toBe(true)
    expect(result.current.count).toBe(99)
  })

  it('does not re-seed when the options change after mount (the hook owns the state)', () => {
    const emitMockTelemetry = vi.fn()
    const base: UseReactionToggleOptions = {
      postId: 'post-1',
      kind: 'like',
      initialCount: 10,
      initiallyActive: false,
      canAct: true,
      failureMessage: 'x',
      emitMockTelemetry,
    }
    const { result, rerender } = renderHook((o: UseReactionToggleOptions) => useReactionToggle(o), {
      initialProps: base,
    })

    rerender({ ...base, initialCount: 500, initiallyActive: true })

    expect(result.current.count).toBe(10)
    expect(result.current.active).toBe(false)
  })
})
