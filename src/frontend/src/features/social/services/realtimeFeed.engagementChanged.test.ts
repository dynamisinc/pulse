/**
 * features/social/services/realtimeFeed.engagementChanged.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback story 14 (DF-17 / DF-18): the feed transport's `PostEngagementChanged` surface.
 *
 *  - The STRICT validator keeps a frame only with a non-empty string `postId`, three
 *    non-negative integer counts and a non-negative integer `version`, and rebuilds it with
 *    exactly those keys (never `viewer`, `active` or who reacted).
 *  - `subscribeEngagementChanged` (an `EngagementChangeSource`, shaped like `PinChangeSource`)
 *    delivers each valid push on the existing connection, isolates a throwing handler, and
 *    delivers nothing after unsubscribe or `stop()`.
 *  - The app-wide default source is wired into `postCountsStore`.
 */
import { describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import {
  createRealtimeFeed,
  defaultEngagementChangeSource,
  realtimeFeed,
  toPostEngagementChangedEvent,
} from './realtimeFeed'

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

const GOOD = { postId: 'post-1', counts: { reply: 2, repost: 0, like: 9 }, version: 14 }

describe('toPostEngagementChangedEvent (strict validator)', () => {
  it('keeps a well-formed frame, rebuilt with exactly postId, counts and version', () => {
    const event = toPostEngagementChangedEvent({
      ...GOOD,
      viewer: { liked: true, reposted: false },
      active: true,
      actorPersonaId: 'persona-secret',
      counts: { ...GOOD.counts, baselineLike: 7 },
    })

    expect(event).toEqual(GOOD)
    expect(Object.keys(event ?? {})).toEqual(['postId', 'counts', 'version'])
    expect(Object.keys(event?.counts ?? {})).toEqual(['reply', 'repost', 'like'])
  })

  it('accepts zero counts and version zero', () => {
    const zero = { postId: 'p', counts: { reply: 0, repost: 0, like: 0 }, version: 0 }
    expect(toPostEngagementChangedEvent(zero)).toEqual(zero)
  })

  it.each([
    ['null', null],
    ['a string', 'PostEngagementChanged'],
    ['an array', [GOOD]],
    ['no postId', { counts: GOOD.counts, version: 1 }],
    ['an empty postId', { ...GOOD, postId: '' }],
    ['a numeric postId', { ...GOOD, postId: 42 }],
    ['no counts', { postId: 'p', version: 1 }],
    ['null counts', { ...GOOD, counts: null }],
    ['a missing count', { ...GOOD, counts: { reply: 1, repost: 2 } }],
    ['a negative count', { ...GOOD, counts: { reply: -1, repost: 0, like: 0 } }],
    ['a fractional count', { ...GOOD, counts: { reply: 0, repost: 1.5, like: 0 } }],
    ['a string count', { ...GOOD, counts: { reply: 0, repost: 0, like: '3' } }],
    ['an infinite count', { ...GOOD, counts: { reply: 0, repost: 0, like: Infinity } }],
    ['a NaN count', { ...GOOD, counts: { reply: Number.NaN, repost: 0, like: 0 } }],
    ['no version', { postId: 'p', counts: GOOD.counts }],
    ['a negative version', { ...GOOD, version: -1 }],
    ['a fractional version', { ...GOOD, version: 3.5 }],
    ['a string version', { ...GOOD, version: '14' }],
  ])('drops a frame with %s', (_label, payload) => {
    expect(toPostEngagementChangedEvent(payload)).toBeNull()
  })
})

describe('subscribeEngagementChanged (EngagementChangeSource)', () => {
  it('is exposed on the app-wide singleton and the default source', () => {
    const off = realtimeFeed.subscribeEngagementChanged(() => {})
    expect(typeof off).toBe('function')
    off()
    const offDefault = defaultEngagementChangeSource.subscribeEngagementChanged(() => {})
    expect(typeof offDefault).toBe('function')
    offDefault()
  })

  it('delivers each valid push from the existing connection and drops malformed ones', async () => {
    const { connection, feed } = await startedFeed()
    const handler = vi.fn()
    feed.subscribeEngagementChanged(handler)

    connection.emit('PostEngagementChanged', GOOD)
    connection.emit('PostEngagementChanged', { ...GOOD, version: -3 })
    connection.emit('PostEngagementChanged', { postId: 'post-1' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(GOOD)
  })

  it('isolates a throwing handler, so the others still hear the frame', async () => {
    const { connection, feed } = await startedFeed()
    const heard = vi.fn()
    feed.subscribeEngagementChanged(() => {
      throw new Error('boom')
    })
    feed.subscribeEngagementChanged(heard)

    connection.emit('PostEngagementChanged', GOOD)

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('delivers nothing after unsubscribe (idempotent) or after stop()', async () => {
    const { connection, feed } = await startedFeed()
    const unsubscribed = vi.fn()
    const stopped = vi.fn()
    const off = feed.subscribeEngagementChanged(unsubscribed)
    feed.subscribeEngagementChanged(stopped)

    off()
    off()
    connection.emit('PostEngagementChanged', GOOD)
    expect(unsubscribed).not.toHaveBeenCalled()
    expect(stopped).toHaveBeenCalledTimes(1)

    feed.stop()
    connection.emit('PostEngagementChanged', { ...GOOD, version: 15 })
    expect(stopped).toHaveBeenCalledTimes(1)
  })
})
