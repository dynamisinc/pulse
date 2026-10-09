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
 *    depth on the frontend, independent of the server's own guarantee);
 *  - CONTRACT v2 (demo-polish F2): a pushed payload KEEPS `media` and
 *    `inReplyTo`, DROPS malformed media entries (never crashing the stream or
 *    hiding the post), omits a malformed `inReplyTo`, and never copies
 *    provenance — not at the payload level, not inside a media entry, not
 *    inside the reply object.
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

// -----------------------------------------------------------------------------
// Contract v2 (demo-polish F2): media + inReplyTo survive the rebuild
// -----------------------------------------------------------------------------

const GOOD_PHOTO = {
  id: 'media-1',
  kind: 'image',
  url: 'https://store.blob.core.windows.net/m/a.jpg?sig=abc',
  alt: 'Floodwater on Main Street',
  width: 1600,
  height: 900,
}

const GOOD_VIDEO = {
  id: 'media-2',
  kind: 'video',
  url: 'https://store.blob.core.windows.net/m/b.mp4?sig=def',
  alt: 'A crew explains the advisory',
  posterUrl: 'https://store.blob.core.windows.net/m/b.jpg?sig=ghi',
  width: 640,
  height: 360,
  durationSec: 24,
}

async function deliver(payload: unknown): Promise<Array<Record<string, unknown>>> {
  const connection = new FakeConnection()
  const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
  const received: Array<Record<string, unknown>> = []
  feed.subscribe(post => received.push(post as unknown as Record<string, unknown>))
  await feed.start()
  connection.push(payload)
  feed.stop()
  return received
}

describe('createRealtimeFeed — v2 payload: media and inReplyTo are kept', () => {
  it('keeps a photo and a video with every contract member', async () => {
    const [post] = await deliver(buildPushPayload({ media: [GOOD_PHOTO, GOOD_VIDEO] }))

    expect(post?.media).toEqual([GOOD_PHOTO, GOOD_VIDEO])
  })

  it('keeps inReplyTo (a reply broadcast)', async () => {
    const [post] = await deliver(
      buildPushPayload({ inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' } }),
    )

    expect(post?.inReplyTo).toEqual({ postId: 'post-parent', authorHandle: 'FulcoEM' })
  })

  it('delivers media and inReplyTo together, with the v1 fields intact', async () => {
    const [post] = await deliver(buildPushPayload({
      id: 'post-reply-1',
      media: [GOOD_PHOTO],
      inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
    }))

    expect(post).toEqual({
      id: 'post-reply-1',
      authorPersonaId: 'persona-a',
      text: 'pushed post',
      scenarioTime: '2033-09-04T13:05:00Z',
      counts: { reply: 0, repost: 0, like: 0 },
      media: [GOOD_PHOTO],
      inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
    })
  })

  it('has NO media / inReplyTo key at all on a plain v1 payload', async () => {
    const [post] = await deliver(buildPushPayload())

    expect(post).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(post, 'media')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(post, 'inReplyTo')).toBe(false)
  })

  it('treats a null optional member (a server that forgot WhenWritingNull) as absent', async () => {
    const [post] = await deliver(buildPushPayload({
      media: [{ ...GOOD_PHOTO, posterUrl: null, durationSec: null }],
      inReplyTo: null,
    }))

    expect(post?.media).toEqual([GOOD_PHOTO])
    expect(Object.prototype.hasOwnProperty.call(post, 'inReplyTo')).toBe(false)
  })

  it('rebuilds the media list (a fresh array of fresh objects, not the wire references)', async () => {
    const wire = [{ ...GOOD_PHOTO }]
    const [post] = await deliver(buildPushPayload({ media: wire }))

    const delivered = post?.media as Array<Record<string, unknown>>
    expect(delivered).not.toBe(wire)
    expect(delivered[0]).not.toBe(wire[0])
  })
})

describe('createRealtimeFeed — v2 payload: malformed entries are dropped, the stream survives', () => {
  const malformed: Array<[string, unknown]> = [
    ['no id', { ...GOOD_PHOTO, id: undefined }],
    ['an empty id', { ...GOOD_PHOTO, id: '' }],
    ['an unknown kind', { ...GOOD_PHOTO, kind: 'audio' }],
    ['no kind', { ...GOOD_PHOTO, kind: undefined }],
    ['no url', { ...GOOD_PHOTO, url: undefined }],
    ['an empty url', { ...GOOD_PHOTO, url: '' }],
    ['no alt (REQUIRED, NFR-001)', { ...GOOD_PHOTO, alt: undefined }],
    ['a blank alt', { ...GOOD_PHOTO, alt: '   ' }],
    ['a non-string alt', { ...GOOD_PHOTO, alt: 42 }],
    ['a wrong-typed width', { ...GOOD_PHOTO, width: '1600' }],
    ['a non-finite height', { ...GOOD_PHOTO, height: Number.POSITIVE_INFINITY }],
    ['a wrong-typed posterUrl', { ...GOOD_VIDEO, posterUrl: 7 }],
    ['null', null],
    ['a string', 'media-1'],
    ['a number', 7],
    ['an array', [GOOD_PHOTO]],
  ]

  it.each(malformed)('drops an entry with %s but still delivers the post and the good entry', async (_label, bad) => {
    const posts = await deliver(buildPushPayload({ media: [bad, GOOD_VIDEO] }))

    expect(posts).toHaveLength(1)
    expect(posts[0]?.media).toEqual([GOOD_VIDEO])
  })

  it('omits media entirely when every entry is malformed (the post is still delivered)', async () => {
    const posts = await deliver(buildPushPayload({ media: [null, { id: 'x' }, 'nope'] }))

    expect(posts).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(posts[0], 'media')).toBe(false)
  })

  it.each([
    ['an empty array', []],
    ['an object', { 0: GOOD_PHOTO }],
    ['a string', 'media'],
    ['a number', 3],
    ['null', null],
  ])('omits media when it is %s', async (_label, media) => {
    const posts = await deliver(buildPushPayload({ media }))

    expect(posts).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(posts[0], 'media')).toBe(false)
  })

  it.each([
    ['no postId', { authorHandle: 'FulcoEM' }],
    ['an empty postId', { postId: '', authorHandle: 'FulcoEM' }],
    ['no authorHandle', { postId: 'post-parent' }],
    ['a non-string authorHandle', { postId: 'post-parent', authorHandle: 9 }],
    ['a string', 'post-parent'],
    ['an array', ['post-parent', 'FulcoEM']],
  ])('omits a malformed inReplyTo (%s) and still delivers the post', async (_label, inReplyTo) => {
    const posts = await deliver(buildPushPayload({ inReplyTo }))

    expect(posts).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(posts[0], 'inReplyTo')).toBe(false)
  })

  it('does not throw on a hostile payload (cyclic / getter-laden media)', async () => {
    const cyclic: Record<string, unknown> = { ...GOOD_PHOTO }
    cyclic.self = cyclic

    await expect(deliver(buildPushPayload({ media: [cyclic] }))).resolves.toHaveLength(1)
  })
})

describe('createRealtimeFeed — v2 payload: provenance never rides along (XC-002)', () => {
  const PROVENANCE = {
    origin: 'inject',
    actingHumanId: 'human-simcell',
    createdWallClock: '2026-07-01T00:00:00.000Z',
    injectId: 'INJ-042',
    exerciseId: 'ex-other',
    viewer: { liked: true, reposted: true },
    linkPreview: { title: 'x', domain: 'y' },
    uploadedByHumanId: 'human-simcell',
    fileName: 'secret-source.mp4',
    uploadedAtScenario: '2033-09-04T12:00:00Z',
  }

  it('copies no provenance key from the payload when media and inReplyTo are present', async () => {
    const [post] = await deliver(buildPushPayload({
      media: [GOOD_PHOTO],
      inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
      ...PROVENANCE,
    }))

    expect(post).toBeDefined()
    for (const key of Object.keys(PROVENANCE)) {
      expect(Object.prototype.hasOwnProperty.call(post, key)).toBe(false)
    }
    expect(Object.keys(post ?? {}).sort()).toEqual(
      ['authorPersonaId', 'counts', 'id', 'inReplyTo', 'media', 'scenarioTime', 'text'],
    )
  })

  it('copies no provenance key from INSIDE a media entry', async () => {
    const [post] = await deliver(buildPushPayload({
      media: [{ ...GOOD_VIDEO, ...PROVENANCE }],
    }))

    const [item] = post?.media as Array<Record<string, unknown>>
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['alt', 'durationSec', 'height', 'id', 'kind', 'posterUrl', 'url', 'width'],
    )
  })

  it('copies no extra key from INSIDE inReplyTo', async () => {
    const [post] = await deliver(buildPushPayload({
      inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM', ...PROVENANCE },
    }))

    expect(post?.inReplyTo).toEqual({ postId: 'post-parent', authorHandle: 'FulcoEM' })
  })
})

describe('createRealtimeFeed — v2 on the polling fallback', () => {
  it('delivers media and inReplyTo from a polled Post too (no regression vs. push)', async () => {
    vi.useFakeTimers()
    const connection = new FakeConnection()
    connection.startImpl = () => Promise.reject(new Error('hub unreachable'))
    const fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValueOnce([])
    const feed = createRealtimeFeed({
      connection, fetchFeed, pollIntervalMs: 1000, reconnectWindowMs: 5000,
    })
    const received: Array<Record<string, unknown>> = []
    feed.subscribe(post => received.push(post as unknown as Record<string, unknown>))
    await feed.start()
    await vi.advanceTimersByTimeAsync(0) // empty baseline

    fetchFeed.mockResolvedValueOnce([
      buildPersonaAgnosticPost({
        id: 'post-polled',
        media: [{
          id: 'media-1', kind: 'image', url: '/mock-media/photos/a.svg', alt: 'A photo', width: 10, height: 5,
        }],
        inReplyTo: { postId: 'post-parent', authorHandle: 'FulcoEM' },
      }),
    ])
    await vi.advanceTimersByTimeAsync(1000)

    expect(received).toHaveLength(1)
    expect(received[0]?.media).toEqual([
      { id: 'media-1', kind: 'image', url: '/mock-media/photos/a.svg', alt: 'A photo', width: 10, height: 5 },
    ])
    expect(received[0]?.inReplyTo).toEqual({ postId: 'post-parent', authorHandle: 'FulcoEM' })
    expect(Object.prototype.hasOwnProperty.call(received[0], 'origin')).toBe(false)

    feed.stop()
    vi.useRealTimers()
  })
})
