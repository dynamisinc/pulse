/**
 * features/controller/engine/services/liveReviewStore.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE review-queue data source (engine-review-cockpit, story 02
 * mock→live flip; COR-001, COR-053, XC-002):
 *  - `ensureStarted` seeds the snapshot from `GET /api/engine/review-queue`,
 *    mapping the wire DTO into the frozen `EngineReviewItem`/`DelayedAutoCountdown`;
 *  - a `ReviewItemChanged` push upserts an in-queue disposition (e.g. `held`)
 *    and REMOVES a resolved one (`published`/`vetoed`) — the by-draftId/
 *    disposition reconciliation rule;
 *  - a malformed GET body or push payload is dropped, never crashing the store
 *    or corrupting the snapshot (fail-closed, COR-001);
 *  - `removeItemOptimistically` mutates the snapshot synchronously and notifies;
 *  - `resetForTests` tears the subscription down and clears the snapshot.
 *
 * Uses a hand-rolled fake `RealtimeConnection` (the module's own test seam —
 * `ensureStarted(connection)` accepts an override) and a mocked `api.get`
 * (`vi.mock('@/core/services/api')`, hoisted above imports by Vitest).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import { DraftDisposition } from '../models/reviewContracts'
import { liveReviewStore } from './liveReviewStore'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: () => Promise.resolve({ data: {} }),
  },
}))

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  startCallCount = 0
  startImpl: () => Promise<void> = () => Promise.resolve()

  private readonly pushHandlers = new Set<RealtimeEventHandler>()
  private readonly stateListeners = new Set<(state: HubConnectionState) => void>()

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    if (eventName !== 'ReviewItemChanged') return () => {}
    this.pushHandlers.add(handler)
    return () => this.pushHandlers.delete(handler)
  }

  onStateChange(listener: (state: HubConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  start(): Promise<void> {
    this.startCallCount += 1
    return this.startImpl().then(() => {
      this.setState(HubConnectionState.Connected)
    })
  }

  push(payload: unknown): void {
    for (const handler of this.pushHandlers) handler(payload)
  }

  setState(state: HubConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }
}

function wireItem(overrides: Record<string, unknown> = {}) {
  return {
    exerciseId: 'ex-live-0001',
    storylineId: 'storyline-live',
    draftId: 'draft-live-1',
    routedAtLevel: 'delayed-auto',
    disposition: 'counting-down',
    countdown: {
      exerciseId: 'ex-live-0001',
      storylineId: 'storyline-live',
      draftId: 'draft-live-1',
      startedScenarioMinute: 10,
      countdownMinutes: 3,
      decision: 'none',
    },
    posts: [
      { personaHandle: 'FulcoEM', text: 'draft text', sentiment: 0, hashtags: ['#Tag'] },
    ],
    storylineTag: '#Tag',
    storylineBrief: 'brief',
    actionLabel: 'reply → @someone',
    ...overrides,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  getMock.mockReset()
  liveReviewStore.resetForTests()
})

afterEach(() => {
  liveReviewStore.resetForTests()
})

describe('liveReviewStore — initial GET + wire mapping', () => {
  it('seeds the snapshot from the GET, mapping the wire DTO into EngineReviewItem/DelayedAutoCountdown', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()

    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()

    const items = liveReviewStore.getItems()
    expect(items).toHaveLength(1)
    expect(items[0]?.draftId).toBe('draft-live-1')
    expect(items[0]?.disposition).toBe(DraftDisposition.CountingDown)
    expect(items[0]?.countdown?.countdownMinutes).toBe(3)
    expect(items[0]?.posts[0]?.personaHandle).toBe('FulcoEM')
    expect(getMock).toHaveBeenCalledWith('/engine/review-queue')
  })

  it('drops a malformed GET body and keeps the previous snapshot (fail-closed)', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()
    expect(liveReviewStore.getItems()).toHaveLength(1)

    getMock.mockResolvedValue({ data: [{ bogus: true }] })
    connection.setState(HubConnectionState.Connected) // triggers a refetch
    await flushMicrotasks()

    expect(liveReviewStore.getItems()).toHaveLength(1)
  })

  it('is idempotent — a second ensureStarted does not re-GET or re-subscribe', async () => {
    getMock.mockResolvedValue({ data: [] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()
    const callsAfterFirst = getMock.mock.calls.length

    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()

    expect(getMock.mock.calls.length).toBe(callsAfterFirst)
  })
})

describe('liveReviewStore — ReviewItemChanged reconciliation', () => {
  it('upserts an item pushed with an in-queue disposition (e.g. held — "moved to NEEDS YOU")', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()

    connection.push(wireItem({ disposition: 'held', countdown: null }))

    const items = liveReviewStore.getItems()
    expect(items).toHaveLength(1)
    expect(items[0]?.disposition).toBe(DraftDisposition.Held)
  })

  it('removes an item pushed as resolved ("left the queue" — published/vetoed)', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()
    expect(liveReviewStore.getItems()).toHaveLength(1)

    connection.push(wireItem({ disposition: 'published', countdown: null }))

    expect(liveReviewStore.getItems()).toHaveLength(0)
  })

  it('appends a brand-new pushed item not yet in the snapshot', async () => {
    getMock.mockResolvedValue({ data: [] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()

    connection.push(wireItem({ draftId: 'draft-new', disposition: 'queued', countdown: null }))

    const items = liveReviewStore.getItems()
    expect(items).toHaveLength(1)
    expect(items[0]?.draftId).toBe('draft-new')
  })

  it('drops a malformed push payload without touching the snapshot', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()

    connection.push({ not: 'a review item' })

    expect(liveReviewStore.getItems()).toHaveLength(1)
    expect(liveReviewStore.getItems()[0]?.draftId).toBe('draft-live-1')
  })
})

describe('liveReviewStore — optimistic removal + teardown', () => {
  it('removeItemOptimistically mutates the snapshot synchronously and notifies subscribers', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()

    const listener = vi.fn()
    const unsubscribe = liveReviewStore.subscribe(listener)

    liveReviewStore.removeItemOptimistically('draft-live-1')

    expect(liveReviewStore.getItems()).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('resetForTests clears the snapshot and listeners', async () => {
    getMock.mockResolvedValue({ data: [wireItem()] })
    const connection = new FakeConnection()
    liveReviewStore.ensureStarted(connection)
    await flushMicrotasks()
    expect(liveReviewStore.getItems()).toHaveLength(1)

    liveReviewStore.resetForTests()

    expect(liveReviewStore.getItems()).toHaveLength(0)
  })
})
