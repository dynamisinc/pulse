/**
 * features/social/services/realtimeFeed.pinChanged.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback story 07 (DF-7): the feed transport's `PostPinChanged` surface and the
 * pin members a `PostReceived` keeps.
 *
 *  - `subscribePinChanged` (the FROZEN name story 08 uses) delivers each well-formed
 *    `{ postId, pinnedForAll }` push, rebuilt with exactly those two keys (never who
 *    pinned it); malformed payloads are dropped; a throwing handler never starves the
 *    others; unsubscribe is idempotent; nothing is delivered after `stop()`.
 *  - `PostReceived` keeps `pinnedForAll: true` and omits anything else; `viewer` is still
 *    never copied from a broadcast.
 */
import { describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import { createRealtimeFeed, realtimeFeed } from './realtimeFeed'
import type { PostStreamHandler } from './realtimeFeed'

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  private readonly handlers = new Map<string, Set<RealtimeEventHandler>>()

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    const set = this.handlers.get(eventName) ?? new Set<RealtimeEventHandler>()
    set.add(handler)
    this.handlers.set(eventName, set)
    return () => {
      set.delete(handler)
    }
  }

  onStateChange(): () => void {
    return () => {}
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  start(): Promise<void> {
    this.state = HubConnectionState.Connected
    return Promise.resolve()
  }

  emit(eventName: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(eventName) ?? [])]) handler(payload)
  }
}

async function startedFeed() {
  const connection = new FakeConnection()
  const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
  await feed.start()
  return { connection, feed }
}

describe('realtimeFeed.subscribePinChanged (DF-7, frozen name)', () => {
  it('is exposed on the app-wide singleton under the frozen name', () => {
    expect(typeof realtimeFeed.subscribePinChanged).toBe('function')
    const off = realtimeFeed.subscribePinChanged(() => {})
    expect(typeof off).toBe('function')
    off()
  })

  it('delivers each well-formed push as exactly { postId, pinnedForAll }', async () => {
    const { connection, feed } = await startedFeed()
    const handler = vi.fn()
    feed.subscribePinChanged(handler)

    connection.emit('PostPinChanged', { postId: 'post-1', pinnedForAll: true })
    connection.emit('PostPinChanged', {
      postId: 'post-2',
      pinnedForAll: false,
      pinnedForAllByHumanId: 'human-secret',
      pinnedForAllAt: '2033-09-04T13:00:00Z',
    })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0]?.[0]).toEqual({ postId: 'post-1', pinnedForAll: true })
    const second = handler.mock.calls[1]?.[0] as Record<string, unknown>
    expect(Object.keys(second).sort()).toEqual(['pinnedForAll', 'postId'])
    expect(second).toEqual({ postId: 'post-2', pinnedForAll: false })
  })

  it('drops malformed payloads', async () => {
    const { connection, feed } = await startedFeed()
    const handler = vi.fn()
    feed.subscribePinChanged(handler)

    for (const payload of [
      null,
      'post-1',
      {},
      { postId: '', pinnedForAll: true },
      { postId: 42, pinnedForAll: true },
      { postId: 'post-1' },
      { postId: 'post-1', pinnedForAll: 'true' },
    ]) {
      connection.emit('PostPinChanged', payload)
    }

    expect(handler).not.toHaveBeenCalled()
  })

  it('isolates a throwing handler and unsubscribes idempotently', async () => {
    const { connection, feed } = await startedFeed()
    const good = vi.fn()
    feed.subscribePinChanged(() => {
      throw new Error('boom')
    })
    const off = feed.subscribePinChanged(good)

    connection.emit('PostPinChanged', { postId: 'post-1', pinnedForAll: true })
    expect(good).toHaveBeenCalledTimes(1)

    off()
    off()
    connection.emit('PostPinChanged', { postId: 'post-1', pinnedForAll: false })
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('delivers nothing after stop()', async () => {
    const { connection, feed } = await startedFeed()
    const handler = vi.fn()
    feed.subscribePinChanged(handler)

    feed.stop()
    connection.emit('PostPinChanged', { postId: 'post-1', pinnedForAll: true })

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('PostReceived keeps pinnedForAll (story 07)', () => {
  function payload(overrides: Record<string, unknown>) {
    return {
      id: 'post-push-1',
      authorPersonaId: 'persona-a',
      text: 'pushed',
      scenarioTime: '2033-09-04T13:05:00Z',
      counts: { reply: 0, repost: 0, like: 0 },
      ...overrides,
    }
  }

  async function deliver(raw: unknown) {
    const { connection, feed } = await startedFeed()
    const received: Parameters<PostStreamHandler>[0][] = []
    feed.subscribe(post => received.push(post))
    connection.emit('PostReceived', raw)
    return received
  }

  it('keeps pinnedForAll: true', async () => {
    const [post] = await deliver(payload({ pinnedForAll: true }))
    expect(post?.pinnedForAll).toBe(true)
  })

  it('omits a false or malformed pinnedForAll', async () => {
    for (const value of [false, 'true', 1, null]) {
      const [post] = await deliver(payload({ id: `post-${String(value)}`, pinnedForAll: value }))
      expect(post).toBeDefined()
      expect(Object.prototype.hasOwnProperty.call(post, 'pinnedForAll')).toBe(false)
    }
  })

  it('still never copies a viewer from a broadcast (it would be someone else’s state)', async () => {
    const [post] = await deliver(
      payload({ pinnedForAll: true, viewer: { liked: true, reposted: false, pinned: true } }),
    )
    expect(Object.prototype.hasOwnProperty.call(post, 'viewer')).toBe(false)
  })
})
