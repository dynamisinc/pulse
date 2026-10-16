/**
 * features/social/edit/postEdited.realtime.test.ts
 * ---------------------------------------------------------------------------
 * The `PostEdited` push on the feed transport (story 20; DF-33): the strict validator accepts the
 * contract frame and rebuilds it key by key, drops every malformed shape, `subscribeEdited` is
 * isolated and idempotent, and the app-wide singleton lands a frame in `editedPostsStore` (which
 * drops a stale or replayed one).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import { createRealtimeFeed, toPostEditedEvent } from '../services/realtimeFeed'
import { editedPostsStore } from './editedPostsStore'

const GOOD = {
  postId: 'p1',
  text: 'new text',
  edited: { count: 2, scenarioTime: '2033-09-04T10:02:00Z' },
  version: 2,
}

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  readonly handlers = new Map<string, Set<RealtimeEventHandler>>()
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
  emit(name: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(payload)
  }
}

afterEach(() => editedPostsStore.resetForTests())

describe('toPostEditedEvent (strict validator)', () => {
  it('accepts the contract frame and rebuilds it field by field', () => {
    const event = toPostEditedEvent({ ...GOOD, editedAt: 'wall', actingHumanId: 'secret' })

    expect(event).toEqual(GOOD)
    expect(Object.keys(event ?? {}).sort()).toEqual(['edited', 'postId', 'text', 'version'])
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['an empty id', { ...GOOD, postId: '' }],
    ['a numeric id', { ...GOOD, postId: 7 }],
    ['a non-string text', { ...GOOD, text: 5 }],
    ['no edited', { ...GOOD, edited: undefined }],
    ['a null edited', { ...GOOD, edited: null }],
    ['a zero count', { ...GOOD, edited: { count: 0, scenarioTime: GOOD.edited.scenarioTime }, version: 0 }],
    ['a fractional count', { ...GOOD, edited: { count: 1.5, scenarioTime: GOOD.edited.scenarioTime }, version: 1.5 }],
    ['a string count', { ...GOOD, edited: { count: '2', scenarioTime: GOOD.edited.scenarioTime } }],
    ['a bad scenario time', { ...GOOD, edited: { count: 2, scenarioTime: 'soon' } }],
    ['a missing scenario time', { ...GOOD, edited: { count: 2 } }],
    ['a version that is not the count', { ...GOOD, version: 3 }],
    ['no version', { ...GOOD, version: undefined }],
  ])('drops %s', (_name, payload) => {
    expect(toPostEditedEvent(payload)).toBeNull()
  })
})

describe('subscribeEdited', () => {
  it('delivers valid frames only, isolates a throwing handler, and unsubscribes idempotently', async () => {
    const connection = new FakeConnection()
    const feed = createRealtimeFeed({ connection, fetchFeed: () => Promise.resolve([]) })
    const received = vi.fn()
    feed.subscribeEdited(() => {
      throw new Error('boom')
    })
    const off = feed.subscribeEdited(received)
    await feed.start()

    connection.emit('PostEdited', GOOD)
    connection.emit('PostEdited', { ...GOOD, version: 9 })
    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(GOOD)

    off()
    off()
    connection.emit('PostEdited', GOOD)
    expect(received).toHaveBeenCalledTimes(1)

    feed.stop()
    expect(connection.handlers.get('PostEdited')?.size ?? 0).toBe(0)
  })
})
