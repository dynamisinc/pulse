/**
 * features/social/hooks/useAmplify.test.ts
 * ---------------------------------------------------------------------------
 * The repost toggle seam (demo-polish F3; SOC-020, SOC-021, XC-004, COR-053), in
 * MOCK mode through the REAL providers and the real mock adapter:
 *   - seeds from `initialRepostCount` / `initiallyReposted` (the post's `viewer`);
 *   - `toggleRepost` is optimistic (count +/- 1), then confirmed by the adapter, and
 *     emits EXACTLY ONE XC-004 `repost` event per confirmed toggle — undo included —
 *     with the server's payload shape `{ reposted }`, a persona actor, and the
 *     injected SCENARIO instant;
 *   - a failed write rolls back and emits nothing;
 *   - `canAmplify` is true for a writable persona session (the read-only and
 *     no-persona gates are `useAmplify.gating.test.ts`);
 *   - `doQuote` still sanitizes + emits one `quote` event (the Quote UI is hidden
 *     but the action is kept for the later quote story).
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { resetMockReactions, setMockReactionFailure } from '../services/reactionService'
import { useAmplify } from './useAmplify'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    ExerciseContextProvider,
    null,
    createElement(SessionProvider, null, children),
  )
}

const repostEvents = () => getEmittedTelemetryEvents().filter(e => e.eventType === 'repost')

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockReactions()
})

afterEach(() => {
  resetExerciseClock()
  resetMockReactions()
})

describe('useAmplify — repost toggle', () => {
  it('seeds the count and own-state, reposts (+1), then undoes (-1), one event each', async () => {
    setExerciseClock({ scenarioNow: () => new Date('2031-03-01T14:00:00.000Z') })
    const { result } = renderHook(
      () => useAmplify({ postId: 'post-rp-1', initialRepostCount: 7 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canAmplify).toBe(true))
    expect(result.current.repostCount).toBe(7)
    expect(result.current.repostedByViewer).toBe(false)

    act(() => result.current.toggleRepost())
    expect(result.current.repostCount).toBe(8)
    expect(result.current.repostedByViewer).toBe(true)
    await waitFor(() => expect(repostEvents()).toHaveLength(1))

    const [first] = repostEvents()
    expect(first?.channel).toBe('social')
    expect(first?.actor.kind).toBe('persona')
    expect(first?.target).toEqual({ entityType: 'post', entityId: 'post-rp-1' })
    expect(first?.payload).toEqual({ reposted: true })
    // Scenario time only — the injected clock, never wall-clock.
    expect(first?.scenarioTime).toBe('2031-03-01T14:00:00.000Z')

    await waitFor(() => expect(result.current.pending).toBe(false))
    act(() => result.current.toggleRepost())
    expect(result.current.repostCount).toBe(7)
    expect(result.current.repostedByViewer).toBe(false)
    await waitFor(() => expect(repostEvents()).toHaveLength(2))
    expect(repostEvents()[1]?.payload).toEqual({ reposted: false })
  })

  it('honors initiallyReposted: undoing drops the count', async () => {
    const { result } = renderHook(
      () => useAmplify({ postId: 'post-rp-2', initialRepostCount: 10, initiallyReposted: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canAmplify).toBe(true))
    expect(result.current.repostedByViewer).toBe(true)

    act(() => result.current.toggleRepost())

    expect(result.current.repostCount).toBe(9)
    expect(result.current.repostedByViewer).toBe(false)
  })

  it('rolls back and emits nothing when the write fails', async () => {
    const { result } = renderHook(
      () => useAmplify({ postId: 'post-rp-3', initialRepostCount: 7 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.canAmplify).toBe(true))

    setMockReactionFailure(true)
    act(() => result.current.toggleRepost())
    expect(result.current.repostCount).toBe(8)

    await waitFor(() => expect(result.current.errorMessage).toMatch(/couldn't update your repost/i))
    expect(result.current.repostCount).toBe(7)
    expect(result.current.repostedByViewer).toBe(false)
    expect(repostEvents()).toHaveLength(0)
  })

  it('defaults to count 0 / not reposted when the options are omitted', async () => {
    const { result } = renderHook(() => useAmplify({ postId: 'post-rp-4' }), { wrapper })
    await waitFor(() => expect(result.current.canAmplify).toBe(true))

    expect(result.current.repostCount).toBe(0)
    expect(result.current.repostedByViewer).toBe(false)
  })
})

describe('useAmplify — doQuote is kept (the Quote UI is hidden, F3)', () => {
  it('sanitizes the commentary and emits one quote event', async () => {
    const { result } = renderHook(() => useAmplify({ postId: 'post-q-1' }), { wrapper })
    await waitFor(() => expect(result.current.canAmplify).toBe(true))

    let record: ReturnType<typeof result.current.doQuote>
    act(() => {
      record = result.current.doQuote('<b>unconfirmed</b>')
    })

    expect(record?.kind).toBe('quote')
    expect(record?.commentary).not.toContain('<b>')
    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'quote')).toHaveLength(1)
  })
})
