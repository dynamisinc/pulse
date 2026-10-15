/**
 * features/social/notifications/notificationsStore.engagement.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback story 14 (DF-19): likes and reposts on MY posts notify LIVE, from the
 * `PostEngagementChanged` push, instead of waiting for the 30 s feed re-read.
 *
 *  - A like and a repost on my post each raise their row and their announcement ONCE; a
 *    replayed or stale frame (same or lower `version`) and the next re-read that sees the same
 *    counts never notify again.
 *  - The badge moves while the tab is hidden (no read runs then; the frame does).
 *  - Frames that beat the baseline read are held and replayed after it.
 *  - A frame for someone else's post changes nothing; the session unsubscribes on stop.
 *
 * Driven through `createNotificationsStore` with every side effect faked (as in
 * `notificationsStore.test.ts`), plus a fake engagement source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '../types/post'
import type { FeedStreamSource } from '../services/feedStreamSource'
import type {
  EngagementChangeSource,
  PostEngagementChangedEvent,
  PostEngagementChangedHandler,
} from '../services/realtimeFeed'
import { createNotificationsStore, type NotificationsSessionConfig } from './notificationsStore'
import {
  NOTIFICATION_ANNOUNCE_THROTTLE_MS,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_PUBLISH_DELAY_MS,
} from './notificationTypes'

const ME = 'persona-dreyes_fh'
const CONFIG: NotificationsSessionConfig = {
  exerciseId: 'ex-14',
  personaId: ME,
  accountId: 'acct-dreyes',
  handle: 'dreyes_fh',
}

function post(id: string, by: string, like = 0, repost = 0): Post {
  return {
    id,
    exerciseId: 'ex-14',
    authorPersonaId: by,
    actingHumanId: 'human-1',
    text: `Post ${id}`,
    counts: { reply: 0, repost, like },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T14:00:00.000Z',
    origin: 'participant',
  }
}

function frame(
  postId: string,
  like: number,
  repost: number,
  version: number,
): PostEngagementChangedEvent {
  return { postId, counts: { reply: 0, repost, like }, version }
}

function fakeArrivals(): FeedStreamSource {
  return {
    subscribe: () => () => undefined,
    start: () => Promise.resolve(),
    stop: () => undefined,
    mode: 'realtime',
  }
}

function fakeEngagement() {
  const handlers = new Set<PostEngagementChangedHandler>()
  const source: EngagementChangeSource = {
    subscribeEngagementChanged: handler => {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    },
  }
  return {
    source,
    emit: (event: PostEngagementChangedEvent) => {
      for (const handler of [...handlers]) handler(event)
    },
    subscribers: () => handlers.size,
  }
}

function rig(initial: Post[]) {
  const feed = { posts: initial }
  let visible = true
  const engagement = fakeEngagement()
  const fetchFeed = vi.fn<() => Promise<readonly Post[]>>(() => Promise.resolve(feed.posts))
  const store = createNotificationsStore({
    fetchFeed,
    source: fakeArrivals,
    engagement: () => engagement.source,
    removed: { getAll: () => new Set(), has: () => false, subscribe: () => () => undefined },
    isVisible: () => visible,
    onVisibilityChange: () => () => undefined,
    now: () => '2033-09-04T15:00:00.000Z',
    random: () => 0.5,
    readJitterMs: 0,
  })
  return {
    store,
    feed,
    fetchFeed,
    engagement,
    hide: () => { visible = false },
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0)
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const rows = (store: ReturnType<typeof createNotificationsStore>) =>
  store.getSnapshot().items.map(item => `${item.id}=${item.count}${item.unread ? '*' : ''}`)

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('notificationsStore — live likes and reposts (DF-19)', () => {
  it('a like and a repost on my post notify live once each, never twice', async () => {
    const r = rig([post('m1', ME)])
    r.store.start(CONFIG)
    await settle()
    expect(r.store.getSnapshot().status).toBe('ready')
    expect(r.store.getSummary().unread).toBe(0)

    r.engagement.emit(frame('m1', 1, 0, 1))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(rows(r.store)).toEqual(['like:m1=1*'])
    expect(r.store.getSummary().unread).toBe(1)
    expect(r.store.getAnnouncement().text).toBe('1 new like')
    const afterLike = r.store.getAnnouncement().seq

    // A replayed frame and a stale one change nothing.
    r.engagement.emit(frame('m1', 1, 0, 1))
    r.engagement.emit(frame('m1', 0, 0, 0))
    await advance(NOTIFICATION_ANNOUNCE_THROTTLE_MS)
    expect(rows(r.store)).toEqual(['like:m1=1*'])
    expect(r.store.getAnnouncement().seq).toBe(afterLike)

    r.engagement.emit(frame('m1', 1, 1, 2))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(rows(r.store)).toEqual(['like:m1=1*', 'repost:m1=1*'])
    expect(r.store.getSummary().unread).toBe(2)
    expect(r.store.getAnnouncement().text).toBe('1 new repost')
    const afterRepost = r.store.getAnnouncement().seq

    // The 30 s re-read sees the same counts: nothing new to say.
    r.feed.posts = [post('m1', ME, 1, 1)]
    await advance(NOTIFICATION_POLL_INTERVAL_MS + NOTIFICATION_ANNOUNCE_THROTTLE_MS)
    expect(r.fetchFeed.mock.calls.length).toBeGreaterThan(1)
    expect(rows(r.store)).toEqual(['like:m1=1*', 'repost:m1=1*'])
    expect(r.store.getAnnouncement().seq).toBe(afterRepost)
  })

  it('moves the badge while the tab is hidden (no read runs then; the push does)', async () => {
    const r = rig([post('m1', ME, 4, 0)])
    r.store.start(CONFIG)
    await settle()
    const readsBefore = r.fetchFeed.mock.calls.length
    r.hide()

    r.engagement.emit(frame('m1', 6, 0, 9))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)

    expect(r.store.getSummary().unread).toBe(1)
    expect(rows(r.store)).toEqual(['like:m1=2*'])
    expect(r.fetchFeed.mock.calls.length).toBe(readsBefore)
  })

  it('holds frames that beat the baseline read and replays them after it', async () => {
    let resolve: (posts: Post[]) => void = () => {}
    const r = rig([])
    r.fetchFeed.mockImplementationOnce(() => new Promise<Post[]>(done => { resolve = done }))
    r.store.start(CONFIG)
    await settle()

    r.engagement.emit(frame('m1', 2, 0, 3))
    r.engagement.emit(frame('m1', 1, 0, 2)) // older: the newer held frame wins
    resolve([post('m1', ME, 1, 0)])
    await settle()
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)

    expect(rows(r.store)).toEqual(['like:m1=1*'])
  })

  it("ignores a frame for someone else's post, and unsubscribes when the session stops", async () => {
    const r = rig([post('m1', ME), post('o1', 'persona-alex')])
    const stop = r.store.start(CONFIG)
    await settle()
    expect(r.engagement.subscribers()).toBe(1)

    r.engagement.emit(frame('o1', 5, 5, 1))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(rows(r.store)).toEqual([])

    stop()
    expect(r.engagement.subscribers()).toBe(0)
  })
})
