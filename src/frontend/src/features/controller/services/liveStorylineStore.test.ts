/**
 * features/controller/services/liveStorylineStore.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE escalation-dial data source (feature: world-steering,
 * story 09 — "Escalation dial live"; CTL-022, COR-001, COR-053):
 *  - `ensureStarted` seeds the snapshot from the initial GET, then refetches
 *    on the `POLL_MS` interval — no SignalR subscription (deliberately polls,
 *    stays file-disjoint from story 08);
 *  - a second `ensureStarted` call for the SAME id is a no-op (idempotent —
 *    no duplicate interval);
 *  - `ensureStarted` for a DIFFERENT id tears the previous poll down and
 *    starts a fresh one;
 *  - a GET failure leaves the PREVIOUS snapshot in place (COR-001 fail
 *    closed — never substitutes a blank/default storyline);
 *  - `reconcile` applies an authoritative POST response immediately, without
 *    waiting for the next poll tick;
 *  - `resetForTests` clears the snapshot and stops the poll.
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

describe('liveStorylineStore — ensureStarted', () => {
  it('seeds the snapshot from the initial GET', async () => {
    getMock.mockResolvedValue({ data: wireBody({ intensity: 62 }) })

    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot()?.intensity).toBe(62))

    expect(getMock).toHaveBeenCalledWith('/steering/storylines/primary')
  })

  it('is null before the first GET resolves', () => {
    getMock.mockReturnValue(new Promise(() => {})) // never resolves

    liveStorylineStore.ensureStarted('primary')

    expect(liveStorylineStore.getSnapshot()).toBeNull()
  })

  it('refetches on the POLL_MS interval', async () => {
    getMock.mockResolvedValue({ data: wireBody({ intensity: 30 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))

    getMock.mockResolvedValue({ data: wireBody({ intensity: 45 }) })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(getMock).toHaveBeenCalledTimes(2)
    expect(liveStorylineStore.getSnapshot()?.intensity).toBe(45)
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

  it('a call for a DIFFERENT id tears the previous poll down and starts fresh', async () => {
    getMock.mockResolvedValue({ data: wireBody({ storylineId: 'storyline-a' }) })
    liveStorylineStore.ensureStarted('storyline-a')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot()?.storylineId).toBe('storyline-a'))

    getMock.mockResolvedValue({ data: wireBody({ storylineId: 'storyline-b' }) })
    liveStorylineStore.ensureStarted('storyline-b')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot()?.storylineId).toBe('storyline-b'))

    expect(getMock).toHaveBeenLastCalledWith('/steering/storylines/storyline-b')
  })

  it('a GET failure leaves the previous snapshot in place (COR-001 fail closed)', async () => {
    getMock.mockResolvedValueOnce({ data: wireBody({ intensity: 62 }) })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot()?.intensity).toBe(62))

    getMock.mockRejectedValueOnce(new Error('network down'))
    await vi.advanceTimersByTimeAsync(POLL_MS)

    // A transient GET failure must never blank/reset the snapshot.
    expect(liveStorylineStore.getSnapshot()?.intensity).toBe(62)
  })
})

describe('liveStorylineStore — reconcile', () => {
  it('applies an authoritative response immediately, notifying subscribers', () => {
    const listener = vi.fn()
    liveStorylineStore.subscribe(listener)

    liveStorylineStore.reconcile(wireBody({ intensity: 55, targetIntensity: 80 }))

    expect(liveStorylineStore.getSnapshot()).toMatchObject({ intensity: 55, targetIntensity: 80 })
    expect(listener).toHaveBeenCalled()
  })
})

describe('liveStorylineStore — resetForTests', () => {
  it('clears the snapshot and stops the poll', async () => {
    getMock.mockResolvedValue({ data: wireBody() })
    liveStorylineStore.ensureStarted('primary')
    await vi.waitFor(() => expect(liveStorylineStore.getSnapshot()).not.toBeNull())

    liveStorylineStore.resetForTests()
    expect(liveStorylineStore.getSnapshot()).toBeNull()

    getMock.mockClear()
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(getMock).not.toHaveBeenCalled()
  })
})
