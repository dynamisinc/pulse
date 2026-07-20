/**
 * features/social/services/realtimeFeed.test.ts
 * ---------------------------------------------------------------------------
 * Covers story social-api/03 "SignalR feed host"'s degraded-mode polling
 * fallback (NFR-003), plus the transport's XC-002 defence-in-depth on pushed
 * payloads:
 *  - falls back to polling `GET /feed` immediately when the hub is
 *    unreachable on first connect;
 *  - falls back to polling when a reconnect episode outlasts the bounded
 *    reconnect window, and does NOT degrade if it recovers within the window;
 *  - recovers to real-time automatically once degraded, without any manual
 *    intervention (the poll-tick recovery driver);
 *  - dedups a post seen via both push and poll, and never re-emits a post
 *    already observed;
 *  - the FIRST poll while degraded baselines silently (no emit) — only posts
 *    observed after that baseline stream out;
 *  - a malformed/partial pushed payload is dropped, never delivered;
 *  - a pushed payload is rebuilt field-by-field — extra/provenance-shaped
 *    keys on the wire payload never reach a subscriber (XC-002 defence in
 *    depth on the frontend, independent of the server's own guarantee).
 *
 * Fake timers throughout (no real `setTimeout`/`setInterval` waits) — bounded,
 * deterministic, matches the harness's "wait on visible state, not sleeps"
 * rule applied to virtual time instead of wall time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import type { Post } from '@/features/social'
import { createRealtimeFeed } from './realtimeFeed'
import type { PostStreamHandler } from './realtimeFeed'

const POST_RECEIVED_EVENT = 'PostReceived'

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  startCallCount = 0
  startImpl: () => Promise<void> = () => Promise.resolve()

  private readonly pushHandlers = new Set<RealtimeEventHandler>()
  private readonly stateListeners = new Set<(state: HubConnectionState) => void>()

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    if (eventName !== POST_RECEIVED_EVENT) return () => {}
    this.pushHandlers.add(handler)
    return () => this.pushHandlers.delete(handler)
  }

  onStateChange(listener: (state: HubConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  start(): Promise<void> {
    this.startCallCount += 1
    return this.startImpl().then(
      () => {
        this.setState(HubConnectionState.Connected)
      },
      error => {
        throw error
      },
    )
  }

  push(payload: unknown): void {
    for (const handler of this.pushHandlers) handler(payload)
  }

  setState(state: HubConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }
}

function buildPersonaAgnosticPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-a',
    exerciseId: 'ex-mock-0001',
    authorPersonaId: 'persona-a',
    actingHumanId: 'human-a',
    text: 'hello',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T13:00:00Z',
    origin: 'participant',
    ...overrides,
  }
}

function buildPushPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-push-1',
    authorPersonaId: 'persona-a',
    text: 'pushed post',
    scenarioTime: '2033-09-04T13:05:00Z',
    counts: { reply: 0, repost: 0, like: 0 },
    ...overrides,
  }
}

describe('createRealtimeFeed — initial fallback (NFR-003)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to polling immediately when the hub is unreachable on first connect', async () => {
    const connection = new FakeConnection()
    connection.startImpl = () => Promise.reject(new Error('hub unreachable'))
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])

    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 5000, reconnectWindowMs: 15000,
    })
    await feed.start()
    // enterPolling() kicks an immediate tick — flush its microtask queue.
    await vi.advanceTimersByTimeAsync(0)

    expect(feed.mode).toBe('polling')
    expect(fetchFeed).toHaveBeenCalledTimes(1)

    feed.stop()
  })

  it('starts in realtime mode when the hub connects successfully', async () => {
    const connection = new FakeConnection()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])

    const feed = createRealtimeFeed({ connection, fetchFeed })
    await feed.start()

    expect(feed.mode).toBe('realtime')
    expect(fetchFeed).not.toHaveBeenCalled()

    feed.stop()
  })
})

describe('createRealtimeFeed — bounded reconnect window (NFR-003)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('degrades to polling once a reconnect episode outlasts the bounded window', async () => {
    const connection = new FakeConnection()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 1000, reconnectWindowMs: 5000,
    })
    await feed.start()
    expect(feed.mode).toBe('realtime')

    connection.setState(HubConnectionState.Reconnecting)
    expect(feed.mode).toBe('realtime') // still within the window — no premature degrade

    await vi.advanceTimersByTimeAsync(5000)

    expect(feed.mode).toBe('polling')
    expect(fetchFeed).toHaveBeenCalled()

    feed.stop()
  })

  it('does NOT degrade if the hub reconnects before the window elapses', async () => {
    const connection = new FakeConnection()
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 1000, reconnectWindowMs: 5000,
    })
    await feed.start()

    connection.setState(HubConnectionState.Reconnecting)
    await vi.advanceTimersByTimeAsync(2000) // partway through the window
    connection.setState(HubConnectionState.Connected) // recovers in time

    expect(feed.mode).toBe('realtime')

    // Advance well past where the (now-cleared) window timer would have fired, to prove it was
    // actually cancelled rather than merely not-yet-due.
    await vi.advanceTimersByTimeAsync(10000)

    expect(feed.mode).toBe('realtime')
    expect(fetchFeed).not.toHaveBeenCalled()

    feed.stop()
  })

  it('recovers to real-time automatically once degraded — the poll-tick recovery driver', async () => {
    const connection = new FakeConnection()
    connection.startImpl = () => Promise.reject(new Error('hub unreachable'))
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 1000, reconnectWindowMs: 5000,
    })

    await feed.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(feed.mode).toBe('polling')

    // The hub becomes reachable again; the NEXT poll tick's recovery attempt succeeds.
    connection.startImpl = () => Promise.resolve()
    // One more poll interval elapses → retries connection.start().
    await vi.advanceTimersByTimeAsync(1000)

    expect(feed.mode).toBe('realtime')

    feed.stop()
  })
})

describe('createRealtimeFeed — push delivery, dedup, and baseline (NFR-002/SOC-071-adjacent)', () => {
  it('delivers a valid pushed post to subscribers', async () => {
    const connection = new FakeConnection()
    const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
    const received: unknown[] = []
    feed.subscribe(post => received.push(post))
    await feed.start()

    connection.push(buildPushPayload({ id: 'post-1' }))

    expect(received).toEqual([
      { id: 'post-1', authorPersonaId: 'persona-a', text: 'pushed post', scenarioTime: '2033-09-04T13:05:00Z', counts: { reply: 0, repost: 0, like: 0 } },
    ])
    feed.stop()
  })

  it('drops a malformed pushed payload without throwing or delivering it', async () => {
    const connection = new FakeConnection()
    const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
    const received: unknown[] = []
    feed.subscribe(post => received.push(post))
    await feed.start()

    expect(() => connection.push({ id: 'post-missing-fields' })).not.toThrow()
    expect(() => connection.push(null)).not.toThrow()
    expect(() => connection.push('not an object')).not.toThrow()

    expect(received).toEqual([])
    feed.stop()
  })

  it('rebuilds a pushed payload field-by-field — a stray provenance-shaped key never reaches a subscriber (XC-002 defence in depth)', async () => {
    const connection = new FakeConnection()
    const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
    const received: Array<Record<string, unknown>> = []
    feed.subscribe(post => received.push(post as unknown as Record<string, unknown>))
    await feed.start()

    connection.push(buildPushPayload({
      origin: 'inject',
      actingHumanId: 'human-simcell',
      createdWallClock: '2026-07-01T00:00:00.000Z',
      injectId: 'INJ-042',
    }))

    expect(received).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(received[0], 'origin')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(received[0], 'actingHumanId')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(received[0], 'createdWallClock')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(received[0], 'injectId')).toBe(false)
    feed.stop()
  })

  it('never re-delivers a post already seen via push', async () => {
    const connection = new FakeConnection()
    const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
    const handler: PostStreamHandler = vi.fn()
    feed.subscribe(handler)
    await feed.start()

    connection.push(buildPushPayload({ id: 'post-1' }))
    connection.push(buildPushPayload({ id: 'post-1' })) // a duplicate push of the same id

    expect(handler).toHaveBeenCalledTimes(1)
    feed.stop()
  })

  it('the first poll after degrading baselines silently (no emit); only later polls stream new posts', async () => {
    vi.useFakeTimers()
    const connection = new FakeConnection()
    connection.startImpl = () => Promise.reject(new Error('hub unreachable'))
    const existing = buildPersonaAgnosticPost({ id: 'post-existing' })
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValueOnce([existing])
    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 1000, reconnectWindowMs: 5000,
    })
    const received: unknown[] = []
    feed.subscribe(post => received.push(post))

    await feed.start()
    await vi.advanceTimersByTimeAsync(0) // the immediate baseline tick

    expect(received).toEqual([]) // baseline: no emit for what was already on the feed

    const fresh = buildPersonaAgnosticPost({ id: 'post-fresh' })
    fetchFeed.mockResolvedValueOnce([existing, fresh])
    await vi.advanceTimersByTimeAsync(1000) // one more poll interval

    expect(received).toHaveLength(1)
    expect((received[0] as { id: string }).id).toBe('post-fresh')

    feed.stop()
    vi.useRealTimers()
  })

  it('dedups a post observed via poll that was already delivered via push', async () => {
    vi.useFakeTimers()
    const connection = new FakeConnection()
    connection.startImpl = () => Promise.reject(new Error('hub unreachable'))
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValueOnce([])
    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 1000, reconnectWindowMs: 5000,
    })
    const received: unknown[] = []
    feed.subscribe(post => received.push(post))

    await feed.start()
    await vi.advanceTimersByTimeAsync(0) // empty baseline

    // A push arrives for a post that will ALSO show up on the next poll (e.g. a late reconnect
    // race).
    connection.push(buildPushPayload({ id: 'post-shared' }))
    expect(received).toHaveLength(1)

    fetchFeed.mockResolvedValueOnce([buildPersonaAgnosticPost({ id: 'post-shared' })])
    await vi.advanceTimersByTimeAsync(1000)

    expect(received).toHaveLength(1) // no second delivery of the same id via poll

    feed.stop()
    vi.useRealTimers()
  })
})

describe('createRealtimeFeed — subscribe/unsubscribe', () => {
  it('an unsubscribed handler stops receiving posts', async () => {
    const connection = new FakeConnection()
    const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
    const received: unknown[] = []
    const unsubscribe = feed.subscribe(post => received.push(post))
    await feed.start()

    unsubscribe()
    connection.push(buildPushPayload({ id: 'post-1' }))

    expect(received).toEqual([])
    feed.stop()
  })
})
