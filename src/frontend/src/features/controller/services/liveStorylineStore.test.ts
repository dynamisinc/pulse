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

    expect(getMock).toHaveBeenCalledWith('/steering/storylines/primary')
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
    expect(getMock).toHaveBeenLastCalledWith('/steering/storylines/storyline-b')
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

    liveStorylineStore.reconcile(wireBody({ intensity: 55, targetIntensity: 80 }))

    expect(liveStorylineStore.getSnapshot()).toMatchObject({
      status: 'live',
      data: { intensity: 55, targetIntensity: 80 },
    })
    expect(listener).toHaveBeenCalled()
  })
})

describe('liveStorylineStore — refetchNow (Gate-1 S-003)', () => {
  it('re-syncs from the server on demand, independent of the poll interval', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 40 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(40))

    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 77 }) })
    await liveStorylineStore.refetchNow('primary')

    expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(77)
  })

  it('moves to "unavailable" (retaining prior data) when the on-demand re-sync itself fails', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 40 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot().data?.intensity).toBe(40))

    getMock.mockRejectedValueOnce(new Error('still down'))
    await liveStorylineStore.refetchNow('primary')

    expect(liveStorylineStore.getSnapshot()).toMatchObject({ status: 'unavailable', data: { intensity: 40 } })
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
