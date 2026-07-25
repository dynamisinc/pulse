/**
 * features/controller/services/liveStorylineStore.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE escalation-dial data source (feature: world-steering,
 * story 09 — "Escalation dial live"; CTL-022, COR-001, COR-053):
 *  - `ensureStarted` seeds the snapshot from the initial GET, then refetches
 *    on the `POLL_MS` interval — no SignalR subscription (deliberately polls,
 *    stays file-disjoint from story 08);
 *  - every read is `{ status, data }`, never data alone (Gate-1 CR-002):
 *    `'loading'` before the first GET resolves, `'live'` after a successful
 *    GET/`reconcile`, `'unavailable'` after a failed GET — with `data`
 *    RETAINED (never blanked) across an `'unavailable'` transition;
 *  - a second `ensureStarted` call for the SAME id is a no-op (idempotent —
 *    no duplicate interval);
 *  - `ensureStarted` for a DIFFERENT id tears the previous poll down, resets
 *    to `'loading'`, and starts fresh;
 *  - `reconcile` applies an authoritative POST response immediately (status
 *    `'live'`), without waiting for the next poll tick;
 *  - `refetchNow` (Gate-1 S-003) re-syncs from the server on demand — the
 *    public re-sync entry point a failed write calls;
 *  - `ensureStarted`/`release` are reference-counted (Gate-1 W-006): the poll
 *    keeps running while at least one consumer holds a reference, and stops
 *    the instant the count reaches zero;
 *  - `resetForTests` clears the snapshot, the reference count, and stops the
 *    poll.
 *
 * `@/core/services/api` is mocked at the module boundary (mirrors
 * `liveReviewStore.test.ts`); fake timers drive the poll interval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
  },
}))

import type { LiveStorylineSteeringState } from './liveStorylineActions'
import { liveStorylineStore, POLL_MS } from './liveStorylineStore'

function wireBody(overrides: Partial<LiveStorylineSteeringState> = {}): LiveStorylineSteeringState {
  return {
    storylineId: 'storyline-real-guid',
    title: 'Water main contamination fears',
    exerciseId: 'ex-live-0001',
    intensity: 40,
    targetIntensity: null,
    phase: 'Escalating',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  getMock.mockReset()
  liveStorylineStore.resetForTests()
})

afterEach(() => {
  liveStorylineStore.resetForTests()
  vi.useRealTimers()
})

describe('liveStorylineStore — status (Gate-1 CR-002: never data alone)', () => {
  it('is "loading" with no data before the first GET resolves', () => {
    getMock.mockReturnValue(new Promise(() => {})) // never resolves within this test

    liveStorylineStore.ensureStarted('primary')

    expect(liveStorylineStore.getSnapshot()).toEqual({ status: 'loading', data: null })
  })

  it('seeds the snapshot from the initial GET and moves to "live"', async () => {
    getMock.mockResolvedValue({ data: wireBody({ intensity: 62 }) })

    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('live'))

    expect(getMock).toHaveBeenCalledWith('/steering/storylines/primary', { timeout: 8000 })
    expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(62)
  })

  it('a GET failure moves to "unavailable" but RETAINS the previous data (COR-001 resilience)', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 62 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('live'))

    getMock.mockRejectedValueOnce(new Error('network down'))
    await vi.advanceTimersByTimeAsync(POLL_MS)

    const snapshot = liveStorylineStore.getSnapshot()
    expect(snapshot.status).toBe('unavailable')
    // The data is RETAINED — never fabricated/blanked — but `status` tells
    // the truth that it is no longer confirmed live (CR-002's whole point).
    expect(snapshot.data?.intensity).toBe(62)
  })

  it('a GET failure with NO prior data ever leaves status "unavailable" with null data (never fabricates a value)', async () => {
    getMock.mockRejectedValue(new Error('404 forever — e.g. post-restart registry loss'))

    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('unavailable'))

    expect(liveStorylineStore.getSnapshot().data).toBeNull()
  })
})

describe('liveStorylineStore — polling lifecycle', () => {
  it('refetches on the POLL_MS interval', async () => {
    getMock.mockResolvedValue({ data: wireBody({ intensity: 30 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

    getMock.mockResolvedValue({ data: wireBody({ intensity: 45 }) })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(getMock).toHaveBeenCalledTimes(2)
    expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(45)
  })

  it('a second call for the SAME id is a no-op (no duplicate polling)', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

    liveStorylineStore.ensureStarted('primary')
    await vi.advanceTimersByTimeAsync(POLL_MS)

    // Exactly one more poll tick fired — not two independent pollers.
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('a call for a DIFFERENT id tears the previous poll down, resets to loading, and starts fresh', async () => {
    getMock.mockResolvedValue({ data: wireBody({ storylineId: 'storyline-a' }) })
    liveStorylineStore.ensureStarted('storyline-a')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.storylineId).toBe('storyline-a'))

    getMock.mockResolvedValue({ data: wireBody({ storylineId: 'storyline-b' }) })
    liveStorylineStore.ensureStarted('storyline-b')

    // Reset to loading is synchronous, before the new GET resolves.
    expect(liveStorylineStore.getSnapshot().status).toBe('loading')

    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.storylineId).toBe('storyline-b'))
    expect(getMock).toHaveBeenLastCalledWith('/steering/storylines/storyline-b', { timeout: 8000 })
  })
})

describe('liveStorylineStore — reference-counted lifecycle (Gate-1 W-006)', () => {
  it('release() at zero remaining subscribers stops the poll', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('primary') // acquire #1
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

    liveStorylineStore.release() // back to zero

    getMock.mockClear()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('the poll keeps running while ANY consumer still holds a reference', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('primary') // acquire #1 (dial A)
    liveStorylineStore.ensureStarted('primary') // acquire #2 (dial B, same storyline)
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

    liveStorylineStore.release() // dial A unmounts — dial B is still mounted

    getMock.mockClear()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(getMock).toHaveBeenCalledTimes(1) // still polling for dial B
  })

  it('re-acquiring after dropping to zero resumes polling with a fresh GET', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))
    liveStorylineStore.release()

    getMock.mockClear()
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))
  })

  it('release() never decrements below zero (defensive — an extra release is a no-op)', () => {
    expect(() => liveStorylineStore.release()).not.toThrow()
    expect(() => liveStorylineStore.release()).not.toThrow()
  })
})

describe('liveStorylineStore — reconcile', () => {
  it('applies an authoritative response immediately as "live", notifying subscribers', () => {
    const listener = vi.fn()
    liveStorylineStore.subscribe(listener)
    const token = liveStorylineStore.beginWrite()

    liveStorylineStore.reconcile(wireBody({ intensity: 55, targetIntensity: 80 }), token)

    expect(liveStorylineStore.getSnapshot()).toMatchObject({
      status: 'live',
      data: { intensity: 55, targetIntensity: 80 },
    })
    expect(listener).toHaveBeenCalled()
  })

  it('drops a STALE response (Gate-2 W-102) — a newer write has since begun', () => {
    const tokenA = liveStorylineStore.beginWrite() // e.g. setTarget(60)
    const tokenB = liveStorylineStore.beginWrite() // e.g. setTarget(80), issued after A

    // B's response arrives FIRST.
    liveStorylineStore.reconcile(wireBody({ targetIntensity: 80 }), tokenB)
    expect(liveStorylineStore.getSnapshot().data?.targetIntensity).toBe(80)

    // A's response arrives LATE — must be dropped, never overwrite B's result
    // (a stale response must never win over the currently-latest write,
    // regardless of arrival order).
    liveStorylineStore.reconcile(wireBody({ targetIntensity: 60 }), tokenA)
    expect(liveStorylineStore.getSnapshot().data?.targetIntensity).toBe(80)
  })
})

describe('liveStorylineStore — applyOptimistic preserves status (Gate-2 S-101)', () => {
  it('patches data WITHOUT forcing status to "live" — an optimistic guess never masquerades as confirmed', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 40, targetIntensity: null }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('live'))

    getMock.mockRejectedValueOnce(new Error('down'))
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('unavailable'))

    liveStorylineStore.applyOptimistic({ targetIntensity: 90 })

    const snapshot = liveStorylineStore.getSnapshot()
    expect(snapshot.data?.targetIntensity).toBe(90)
    // An optimistic local patch must never flip an unconfirmed read to "live" by itself.
    expect(snapshot.status).toBe('unavailable')
  })

  it('is a no-op when there is no data yet to patch onto', () => {
    liveStorylineStore.applyOptimistic({ targetIntensity: 90 })

    expect(liveStorylineStore.getSnapshot()).toEqual({ status: 'loading', data: null })
  })
})

describe('liveStorylineStore — refetchNow (Gate-1 S-003)', () => {
  it('re-syncs from the server on demand, independent of the poll interval', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 40 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(40))

    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 77 }) })
    const token = liveStorylineStore.beginWrite()
    await liveStorylineStore.refetchNow('primary', token)

    expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(77)
  })

  it('moves to "unavailable" (retaining prior data) when the on-demand re-sync itself fails', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 40 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(40))

    getMock.mockRejectedValueOnce(new Error('still down'))
    const token = liveStorylineStore.beginWrite()
    await liveStorylineStore.refetchNow('primary', token)

    expect(liveStorylineStore.getSnapshot()).toMatchObject({ status: 'unavailable', data: { intensity: 40 } })
  })

  it('drops a STALE re-sync (Gate-2 W-102) — a newer write has since begun', async () => {
    const staleToken = liveStorylineStore.beginWrite()
    liveStorylineStore.beginWrite() // a newer write supersedes staleToken

    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 999 }) })
    await liveStorylineStore.refetchNow('primary', staleToken)

    expect(liveStorylineStore.getSnapshot()).toEqual({ status: 'loading', data: null })
  })
})

describe('liveStorylineStore — self-healing recovery (Gate-2 W-105)', () => {
  it('a subsequent poll tick that succeeds moves "unavailable" back to "live"', async () => {
    getMock.mockRejectedValueOnce(new Error('404 — registry lost after a restart'))
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('unavailable'))

    // The controller re-seeds via ops; the NEXT poll tick succeeds.
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 12 }) })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('live'))
    expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(12)
  })
})

describe('liveStorylineStore — id re-point invalidates in-flight generations (Gate-2 S-103 + W-102)', () => {
  it('a GET in flight for the PREVIOUS id never lands as "live" after ensureStarted re-points to a new id', async () => {
    let resolvePreviousGet: (value: { data: LiveStorylineSteeringState }) => void = () => {}
    getMock.mockReturnValueOnce(
      new Promise(resolve => {
        resolvePreviousGet = resolve
      }),
    )
    liveStorylineStore.ensureStarted('storyline-a')

    getMock.mockResolvedValueOnce({ data: wireBody({ storylineId: 'storyline-b', intensity: 77 }) })
    liveStorylineStore.ensureStarted('storyline-b')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.storylineId).toBe('storyline-b'))

    // The stale GET for storyline-a resolves LATE — must never overwrite storyline-b's snapshot.
    resolvePreviousGet({ data: wireBody({ storylineId: 'storyline-a', intensity: 1 }) })
    await Promise.resolve()
    await Promise.resolve()

    expect(liveStorylineStore.getSnapshot().data?.storylineId).toBe('storyline-b')
  })

  it('an in-flight write for the OLD id never reconciles against the NEW id (W-102)', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('storyline-a')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('live'))

    const staleWriteToken = liveStorylineStore.beginWrite() // a write in flight for storyline-a

    liveStorylineStore.ensureStarted('storyline-b') // the id changes underneath the in-flight write

    liveStorylineStore.reconcile(wireBody({ storylineId: 'storyline-a', intensity: 999 }), staleWriteToken)

    expect(liveStorylineStore.getSnapshot().data?.storylineId).not.toBe('storyline-a')
  })
})

describe('liveStorylineStore — resetForTests', () => {
  it('clears the snapshot, the reference count, and stops the poll', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().status).toBe('live'))

    liveStorylineStore.resetForTests()
    expect(liveStorylineStore.getSnapshot()).toEqual({ status: 'loading', data: null })

    getMock.mockClear()
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(getMock).not.toHaveBeenCalled()
  })
})
