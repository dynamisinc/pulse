/**
 * features/social/notifications/notificationsStore.test.ts
 * ---------------------------------------------------------------------------
 * The notifications ENGINE (demo-polish F7, story 16 "Live and calm" + "Isolation"), driven
 * through `createNotificationsStore` with every side effect faked: the feed read, the shared
 * arrival source, the removed-post store, tab visibility, the clock and `sessionStorage`
 * (jsdom's real one, cleared per test). Fake timers carry the 30 s read, the publish
 * coalescing window and the announcement throttle.
 *
 * Covered: baseline vs live; arrivals that beat the baseline; the 30 s re-read that notices
 * likes (and only while the tab is visible); no overlapping reads; the burst cost (one
 * coalesced publish, one throttled announcement for 120 arrivals); the row cap; takedowns;
 * "Mark all read" and its exercise- and persona-scoped persistence; stop / restart / reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParticipantPostView, Post } from '../types/post'
import type { FeedStreamSource } from '../services/feedStreamSource'
import {
  createNotificationsStore,
  describeAnnouncement,
  type NotificationsSessionConfig,
} from './notificationsStore'
import {
  NOTIFICATION_STORAGE_PREFIX,
  notificationStorageKey,
  readPersisted,
} from './notificationStorage'
import {
  MAX_NOTIFICATION_ROWS,
  NOTIFICATION_ANNOUNCE_THROTTLE_MS,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_PUBLISH_DELAY_MS,
} from './notificationTypes'

const ME = 'persona-dreyes_fh'
const HANDLE = 'dreyes_fh'
const EXERCISE = 'ex-1'
const CONFIG: NotificationsSessionConfig = { exerciseId: EXERCISE, personaId: ME, handle: HANDLE }

// ---------------------------------------------------------------------------
// Builders and fakes
// ---------------------------------------------------------------------------

interface PostInput {
  readonly id: string
  readonly by?: string
  readonly text?: string
  readonly at?: string
  readonly like?: number
  readonly replyTo?: string
}

/** A FULL `Post` (with provenance), as a feed read returns -- the store narrows it (XC-002). */
function fullPost(input: PostInput): Post {
  return {
    id: input.id,
    exerciseId: EXERCISE,
    authorPersonaId: input.by ?? 'persona-alex',
    actingHumanId: 'human-1',
    text: input.text ?? 'plain text',
    counts: { reply: 0, repost: 0, like: input.like ?? 0 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: input.at ?? '2033-09-04T14:00:00.000Z',
    origin: 'participant',
    ...(input.replyTo !== undefined
      ? { inReplyTo: { postId: input.replyTo, authorHandle: HANDLE } }
      : {}),
  }
}

const mineP = (id: string, like = 0): Post => fullPost({ id, by: ME, like, text: `My post ${id}` })
const replyP = (id: string, parent: string, by = 'persona-alex', at?: string): Post =>
  fullPost({ id, by, replyTo: parent, text: `Reply ${id}`, ...(at !== undefined ? { at } : {}) })
const mentionP = (id: string): Post => fullPost({ id, text: `hello @${HANDLE} (${id})` })

/** Narrows a full post the way the arrival source delivers it (participant-safe). */
function asView(post: Post): ParticipantPostView {
  return {
    id: post.id,
    authorPersonaId: post.authorPersonaId,
    text: post.text,
    counts: post.counts,
    scenarioTime: post.scenarioTime,
    ...(post.inReplyTo !== undefined ? { inReplyTo: post.inReplyTo } : {}),
  }
}

function fakeSource() {
  const handlers = new Set<(post: ParticipantPostView) => void>()
  const calls = { started: 0, stopped: 0 }
  let startResult: () => Promise<void> = () => Promise.resolve()
  const source: FeedStreamSource = {
    subscribe: handler => {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    },
    start: () => {
      calls.started += 1
      return startResult()
    },
    stop: () => { calls.stopped += 1 },
    mode: 'realtime',
  }
  return {
    source,
    calls,
    emit: (post: Post) => { for (const handler of [...handlers]) handler(asView(post)) },
    subscribers: () => handlers.size,
    failStart: () => { startResult = () => Promise.reject(new Error('hub down')) },
  }
}

function fakeRemoved() {
  let ids: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  return {
    store: {
      getAll: () => ids,
      has: (id: string) => ids.has(id),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    add(id: string) {
      ids = new Set([...ids, id])
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

function fakeVisibility() {
  let visible = true
  const listeners = new Set<() => void>()
  return {
    isVisible: () => visible,
    onVisibilityChange: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: boolean) {
      visible = next
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

interface Rig {
  readonly store: ReturnType<typeof createNotificationsStore>
  readonly feed: { posts: Post[] }
  readonly fetchFeed: ReturnType<typeof vi.fn<() => Promise<readonly Post[]>>>
  readonly source: ReturnType<typeof fakeSource>
  readonly removed: ReturnType<typeof fakeRemoved>
  readonly visibility: ReturnType<typeof fakeVisibility>
  readonly clock: { now: string }
  /** Counts store notifications (every publish and every announcement is one). */
  readonly notifications: { count: number }
}

function rig(initial: Post[] = []): Rig {
  const feed = { posts: initial }
  const fetchFeed = vi.fn<() => Promise<readonly Post[]>>(() => Promise.resolve(feed.posts))
  const source = fakeSource()
  const removed = fakeRemoved()
  const visibility = fakeVisibility()
  const clock = { now: '2033-09-04T15:00:00.000Z' }
  const store = createNotificationsStore({
    fetchFeed,
    source: () => source.source,
    removed: removed.store,
    isVisible: visibility.isVisible,
    onVisibilityChange: visibility.onVisibilityChange,
    now: () => clock.now,
  })
  const notifications = { count: 0 }
  store.subscribe(() => { notifications.count += 1 })
  return { store, feed, fetchFeed, source, removed, visibility, clock, notifications }
}

/** A feed read that stays pending until the test calls the captured `resolve`. */
const deferredFeed = (capture: (resolve: (posts: Post[]) => void) => void) => () =>
  new Promise<Post[]>(resolve => capture(resolve))

/** The notification entries currently in the tab's storage. */
const storedKeys = () =>
  Object.keys(window.sessionStorage).filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))

/** Lets already-resolved promises (the feed read) settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
})

// ---------------------------------------------------------------------------

describe('describeAnnouncement', () => {
  const held = (reply: number, mention: number, like: number, events: number) =>
    ({ events, amountByType: { reply, mention, like } })

  it('says one noun when only one kind arrived, counting what arrived', () => {
    expect(describeAnnouncement(held(1, 0, 0, 1))).toBe('1 new reply')
    expect(describeAnnouncement(held(14, 0, 0, 14))).toBe('14 new replies')
    expect(describeAnnouncement(held(0, 1, 0, 1))).toBe('1 new mention')
    expect(describeAnnouncement(held(0, 3, 0, 3))).toBe('3 new mentions')
    expect(describeAnnouncement(held(0, 0, 5, 1))).toBe('5 new likes')
  })

  it('says "notifications" when kinds are mixed, counting events', () => {
    expect(describeAnnouncement(held(2, 1, 0, 3))).toBe('3 new notifications')
    expect(describeAnnouncement(held(1, 0, 4, 2))).toBe('2 new notifications')
  })
})

describe('start: the baseline', () => {
  it('goes loading -> ready; existing replies and mentions are listed and unread, likes are NOT retroactive', async () => {
    const t = rig([mineP('m1', 12), replyP('r1', 'm1'), mentionP('p1')])
    expect(t.store.getSummary()).toEqual({ available: false, unread: 0 })

    t.store.start(CONFIG)
    expect(t.store.getSnapshot().status).toBe('loading')
    expect(t.store.getSummary()).toEqual({ available: true, unread: 0 })

    await settle()
    const snapshot = t.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.items.map(item => item.type).sort()).toEqual(['mention', 'reply'])
    expect(snapshot.unread).toBe(2)
    expect(t.store.getSummary()).toEqual({ available: true, unread: 2 })
    // What was already there is on the badge, not spoken.
    expect(t.store.getAnnouncement().text).toBe('')
  })

  it('reads the feed once up front, through the injected read (the exercise-scoped feed)', async () => {
    const t = rig()
    t.store.start(CONFIG)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
  })

  it('with nothing derived it is ready and honestly empty', async () => {
    const t = rig([mineP('m1', 3), fullPost({ id: 'o1', text: 'weather' })])
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot()).toMatchObject({ status: 'ready', items: [], unread: 0 })
    expect(t.store.getSummary()).toEqual({ available: true, unread: 0 })
  })

  it('holds arrivals that beat the baseline and replays them once it lands', async () => {
    const t = rig([mineP('m1')])
    let resolveFeed: (posts: Post[]) => void = () => undefined
    t.fetchFeed.mockImplementationOnce(deferredFeed(resolve => { resolveFeed = resolve }))

    t.store.start(CONFIG)
    // The reply is classifiable only once my post is known: it arrives first.
    t.source.emit(replyP('r1', 'm1'))
    expect(t.store.getSnapshot().items).toEqual([])

    resolveFeed([mineP('m1')])
    await settle()
    expect(t.store.getSnapshot().items.map(item => item.id)).toEqual(['reply:m1'])
    // It was a live arrival, not part of the baseline, so it IS announced.
    expect(t.store.getAnnouncement().text).toBe('1 new reply')
  })

  it('a source that cannot start never breaks the engine (the 30 s read still runs)', async () => {
    const t = rig([mineP('m1', 1)])
    t.source.failStart()
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot().status).toBe('ready')
    expect(t.source.calls.started).toBe(1)
  })
})

describe('live: replies and mentions through the shared arrival source', () => {
  it('a reply to my post raises the badge, in ONE coalesced publish, and is announced at once', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSummary().unread).toBe(0)

    t.source.emit(replyP('r1', 'm1'))
    // Spoken straight away; the snapshot itself waits for the coalescing window.
    expect(t.store.getAnnouncement().text).toBe('1 new reply')
    expect(t.store.getSummary().unread).toBe(0)

    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSummary().unread).toBe(1)
    expect(t.store.getSnapshot().items[0]).toMatchObject({ id: 'reply:m1', count: 1 })
  })

  it('a mention arrives the same way', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.source.emit(mentionP('p1'))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSnapshot().items.map(item => item.type)).toEqual(['mention'])
    expect(t.store.getAnnouncement().text).toBe('1 new mention')
  })

  it('an arrival that changes nothing publishes nothing and says nothing', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    const before = t.notifications.count
    t.source.emit(fullPost({ id: 'u1', text: 'just chatting' }))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS * 4)
    expect(t.notifications.count).toBe(before)
    expect(t.store.getAnnouncement().text).toBe('')
  })

  it('a new post of mine joins "mine", so replies to it are found', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.source.emit(mineP('fresh')) // the echo of a post I just published
    t.source.emit(replyP('r1', 'fresh'))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSnapshot().items.map(item => item.id)).toEqual(['reply:fresh'])
  })
})

describe('likes: the 30 s re-read, while the tab is visible', () => {
  it('re-reads the feed every 30 s and turns a count rise into one aggregated row', async () => {
    const t = rig([mineP('m1', 12)])
    t.store.start(CONFIG)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)

    t.feed.posts = [mineP('m1', 15)]
    t.clock.now = '2033-09-04T15:30:00.000Z'
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
    expect(t.store.getSnapshot().items[0]).toMatchObject({
      id: 'like:m1',
      count: 3,
      unread: true,
      at: '2033-09-04T15:30:00.000Z',
    })
    expect(t.store.getSummary().unread).toBe(1)
    expect(t.store.getAnnouncement().text).toBe('3 new likes')
  })

  it('does NOT announce the likes already pending at the baseline', async () => {
    const t = rig([mineP('m1', 12)])
    // A stored baseline of 8 means 4 likes accrued before this load.
    window.sessionStorage.setItem(
      notificationStorageKey(EXERCISE, ME),
      JSON.stringify({ v: 1, readIds: [], likes: [{ postId: 'm1', baseline: 8, riseAt: '2033-09-04T10:00:00.000Z' }] }),
    )
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot().items[0]).toMatchObject({ id: 'like:m1', count: 4, at: '2033-09-04T10:00:00.000Z' })
    expect(t.store.getAnnouncement().text).toBe('')
  })

  it('skips a tick while the tab is hidden and makes it up the moment the tab is visible', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.start(CONFIG)
    await settle()

    t.visibility.set(false)
    t.feed.posts = [mineP('m1', 4)]
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 3)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1) // no reads while hidden
    expect(t.store.getSnapshot().items).toEqual([])

    t.visibility.set(true)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
    expect(t.store.getSnapshot().items[0]).toMatchObject({ id: 'like:m1', count: 3 })
  })

  it('does not catch up on becoming visible when no tick was missed', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.start(CONFIG)
    await settle()
    t.visibility.set(false)
    t.visibility.set(true)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
  })

  it('never overlaps reads: a slow read blocks the next tick instead of piling up', async () => {
    const t = rig([mineP('m1')])
    let release: (posts: Post[]) => void = () => undefined
    t.fetchFeed.mockImplementationOnce(() => Promise.resolve([mineP('m1')]))
    t.store.start(CONFIG)
    await settle()
    t.fetchFeed.mockImplementationOnce(() => new Promise<Post[]>(resolve => { release = resolve }))
    await advance(NOTIFICATION_POLL_INTERVAL_MS) // starts the slow read
    await advance(NOTIFICATION_POLL_INTERVAL_MS) // still in flight: skipped
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
    release([mineP('m1')])
    await settle()
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.fetchFeed).toHaveBeenCalledTimes(3)
  })

  it('a re-read also catches a reply the realtime path missed (the polling fallback)', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.feed.posts = [replyP('r9', 'm1'), mineP('m1')]
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.store.getSnapshot().items.map(item => item.id)).toEqual(['reply:m1'])
    expect(t.store.getAnnouncement().text).toBe('1 new reply')
  })

  it('a failed first read is an error state, and the next tick recovers', async () => {
    const t = rig([mineP('m1', 1), replyP('r1', 'm1')])
    t.fetchFeed.mockRejectedValueOnce(new Error('offline'))
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot()).toMatchObject({ status: 'error', items: [] })

    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.store.getSnapshot().status).toBe('ready')
    expect(t.store.getSnapshot().items).toHaveLength(1)
  })

  it('a failed LATER read keeps what is on screen', async () => {
    const t = rig([mineP('m1', 1), replyP('r1', 'm1')])
    t.store.start(CONFIG)
    await settle()
    t.fetchFeed.mockRejectedValueOnce(new Error('offline'))
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.store.getSnapshot()).toMatchObject({ status: 'ready' })
    expect(t.store.getSnapshot().items).toHaveLength(1)
  })
})

describe('calm under a burst (SOC-071, NFR-002)', () => {
  it('120 replies to one post: ONE row, ONE coalesced publish, announcements throttled', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    const before = t.notifications.count

    for (let index = 0; index < 120; index += 1) {
      t.source.emit(replyP(`r${index}`, 'm1', `persona-${index % 7}`))
      t.source.emit(fullPost({ id: `u${index}`, text: 'unrelated chatter' }))
    }
    // 240 arrivals in one tick: exactly one announcement so far (the first), no publish yet.
    expect(t.notifications.count - before).toBe(1)
    expect(t.store.getAnnouncement().text).toBe('1 new reply')

    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.notifications.count - before).toBe(2) // + the single coalesced publish
    expect(t.store.getSnapshot().items).toHaveLength(1)
    expect(t.store.getSnapshot().items[0]).toMatchObject({ id: 'reply:m1', count: 120, actorCount: 7 })
    expect(t.store.getSummary().unread).toBe(1) // one ROW

    await advance(NOTIFICATION_ANNOUNCE_THROTTLE_MS)
    expect(t.store.getAnnouncement().text).toBe('119 new replies') // the rest, once
    expect(t.notifications.count - before).toBe(3)
  })

  it('draws at most MAX_NOTIFICATION_ROWS rows but counts every unread one', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    for (let index = 0; index < MAX_NOTIFICATION_ROWS + 50; index += 1) {
      t.source.emit(mentionP(`p${index}`))
    }
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    const snapshot = t.store.getSnapshot()
    expect(snapshot.items).toHaveLength(MAX_NOTIFICATION_ROWS)
    expect(snapshot.hiddenCount).toBe(50)
    expect(snapshot.unread).toBe(MAX_NOTIFICATION_ROWS + 50)
    expect(t.store.getSummary().unread).toBe(MAX_NOTIFICATION_ROWS + 50)
  })

  it('writes to storage only when the persisted part changed, not per arrival', async () => {
    const t = rig([mineP('m1')])
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    t.store.start(CONFIG)
    await settle()
    const afterBaseline = setItem.mock.calls.length
    expect(afterBaseline).toBe(1) // my post's first-sight baseline
    for (let index = 0; index < 50; index += 1) t.source.emit(replyP(`r${index}`, 'm1'))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(setItem.mock.calls.length).toBe(afterBaseline)
    setItem.mockRestore()
  })
})

describe('the announcement throttle', () => {
  it('speaks the first item at once and then holds the next ones for one combined line', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()

    t.source.emit(replyP('r1', 'm1'))
    expect(t.store.getAnnouncement()).toMatchObject({ seq: 1, text: '1 new reply' })
    t.source.emit(replyP('r2', 'm1'))
    t.source.emit(mentionP('p1'))
    expect(t.store.getAnnouncement().seq).toBe(1) // held

    await advance(NOTIFICATION_ANNOUNCE_THROTTLE_MS)
    expect(t.store.getAnnouncement()).toMatchObject({ seq: 2, text: '2 new notifications' })
  })

  it('a repeat of the same sentence still gets a NEW sequence number (so it is spoken again)', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.source.emit(replyP('r1', 'm1'))
    const first = t.store.getAnnouncement()
    await advance(NOTIFICATION_ANNOUNCE_THROTTLE_MS + 10)
    t.source.emit(replyP('r2', 'm1'))
    const second = t.store.getAnnouncement()
    expect(second.text).toBe(first.text)
    expect(second.seq).toBeGreaterThan(first.seq)
  })
})

describe('taken-down posts drop out', () => {
  it('a removed reply leaves the list at once; the row goes with its last reply', async () => {
    const t = rig([mineP('m1'), replyP('r1', 'm1'), replyP('r2', 'm1', 'persona-sam')])
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot().items[0]).toMatchObject({ count: 2 })

    t.removed.add('r1')
    expect(t.store.getSnapshot().items[0]).toMatchObject({ count: 1 }) // no coalescing delay
    t.removed.add('r2')
    expect(t.store.getSnapshot().items).toEqual([])
    expect(t.store.getSummary().unread).toBe(0)
  })

  it('a removed post of mine takes the replies under it with it', async () => {
    const t = rig([mineP('m1'), replyP('r1', 'm1')])
    t.store.start(CONFIG)
    await settle()
    t.removed.add('m1')
    expect(t.store.getSnapshot().items).toEqual([])
  })

  it('a taken-down post that arrives (or is re-read) later is never listed', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.removed.add('r1')
    t.source.emit(replyP('r1', 'm1'))
    t.feed.posts = [mineP('m1'), replyP('r1', 'm1')]
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.store.getSnapshot().items).toEqual([])
  })

  it('applies removals that were already recorded when the engine starts', async () => {
    const t = rig([mineP('m1'), replyP('r1', 'm1')])
    t.removed.add('r1')
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot().items).toEqual([])
  })
})

describe('"Mark all read": persists per persona under an exercise-scoped key', () => {
  async function started(rigged: Rig, config = CONFIG) {
    const stop = rigged.store.start(config)
    await settle()
    return stop
  }

  it('clears the badge, keeps the rows listed (read), announces, and writes the scoped key', async () => {
    const t = rig([mineP('m1', 2), replyP('r1', 'm1'), mentionP('p1')])
    await started(t)
    expect(t.store.getSummary().unread).toBe(2)

    t.store.markAllRead()
    expect(t.store.getSummary().unread).toBe(0)
    const rows = t.store.getSnapshot().items
    expect(rows).toHaveLength(2)
    expect(rows.every(row => !row.unread)).toBe(true)
    expect(t.store.getAnnouncement().text).toBe('All notifications marked as read')

    const stored = readPersisted(window.sessionStorage, notificationStorageKey(EXERCISE, ME))
    expect([...stored.readIds].sort()).toEqual(['p1', 'r1'])
    const keys = Object.keys(window.sessionStorage)
    expect(keys.filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))).toEqual([
      notificationStorageKey(EXERCISE, ME),
    ])
  })

  it('survives a reload of the same persona in the same exercise', async () => {
    const first = rig([mineP('m1', 2), replyP('r1', 'm1')])
    const stop = await started(first)
    first.store.markAllRead()
    stop() // the tab keeps its sessionStorage; only the in-memory engine goes away

    const second = rig([mineP('m1', 2), replyP('r1', 'm1')])
    await started(second)
    expect(second.store.getSummary().unread).toBe(0)
    expect(second.store.getSnapshot().items[0]).toMatchObject({ id: 'reply:m1', unread: false })
  })

  it('does not leak to another persona: B reads A\'s entry nowhere and starts unread', async () => {
    const a = rig([mineP('m1'), replyP('r1', 'm1')])
    const stopA = await started(a)
    a.store.markAllRead()
    stopA()

    // Persona B sees a reply with the SAME id A marked read; for B it is unread.
    const b = rig([fullPost({ id: 'mb', by: 'persona-b' }), replyP('r1', 'mb')])
    await started(b, { exerciseId: EXERCISE, personaId: 'persona-b', handle: 'persona_b' })
    expect(b.store.getSummary().unread).toBe(1)
    // And B wrote its own key without touching A's.
    expect(readPersisted(window.sessionStorage, notificationStorageKey(EXERCISE, ME)).readIds)
      .toEqual(['r1'])
    expect(window.sessionStorage.getItem(notificationStorageKey(EXERCISE, 'persona-b'))).not.toBeNull()
  })

  it('does not leak to another exercise: the same persona starts unread there', async () => {
    const a = rig([mineP('m1'), replyP('r1', 'm1')])
    const stopA = await started(a)
    a.store.markAllRead()
    stopA()

    const other = rig([mineP('m1'), replyP('r1', 'm1')])
    await started(other, { exerciseId: 'ex-2', personaId: ME, handle: HANDLE })
    expect(other.store.getSummary().unread).toBe(1)
  })

  it('is a no-op with no session', () => {
    const t = rig()
    expect(() => t.store.markAllRead()).not.toThrow()
    expect(t.store.getAnnouncement().text).toBe('')
  })
})

describe('stop / restart / reset', () => {
  it('stop releases the shared source, the timers and the listeners, and is idempotent', async () => {
    const t = rig([mineP('m1')])
    const stop = t.store.start(CONFIG)
    await settle()
    expect(t.source.subscribers()).toBe(1)
    expect(t.removed.listenerCount()).toBe(1)
    expect(t.visibility.listenerCount()).toBe(1)

    stop()
    stop()
    expect(t.source.calls.stopped).toBe(1) // one start() <-> one stop()
    expect(t.source.subscribers()).toBe(0)
    expect(t.removed.listenerCount()).toBe(0)
    expect(t.visibility.listenerCount()).toBe(0)
    expect(t.store.getSummary()).toEqual({ available: false, unread: 0 })

    await advance(NOTIFICATION_POLL_INTERVAL_MS * 3)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1) // the interval is gone
  })

  it('a read that resolves after stop changes nothing', async () => {
    const t = rig([mineP('m1')])
    let resolveFeed: (posts: Post[]) => void = () => undefined
    t.fetchFeed.mockImplementationOnce(deferredFeed(resolve => { resolveFeed = resolve }))
    const stop = t.store.start(CONFIG)
    stop()
    resolveFeed([mineP('m1'), replyP('r1', 'm1')])
    await settle()
    expect(t.store.getSnapshot().items).toEqual([])
    expect(t.store.getSummary().available).toBe(false)
  })

  it('React StrictMode\'s start / stop / start leaves exactly one live session', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)()
    t.store.start(CONFIG)
    await settle()
    expect(t.source.calls.started).toBe(2)
    expect(t.source.calls.stopped).toBe(1)
    expect(t.source.subscribers()).toBe(1)
    expect(t.store.getSummary().available).toBe(true)
  })

  it('starting a new session replaces the old one; the old stop is then a no-op', async () => {
    const t = rig([mineP('m1')])
    const stopOld = t.store.start(CONFIG)
    await settle()
    const stopNew = t.store.start({ ...CONFIG, personaId: 'persona-other', handle: 'other' })
    await settle()
    stopOld()
    expect(t.store.getSummary().available).toBe(true) // the new session still runs
    stopNew()
    expect(t.store.getSummary().available).toBe(false)
    expect(t.source.calls.started).toBe(t.source.calls.stopped)
  })

  it('reset (sign-out) forgets everything and sweeps the storage, for ANY persona', async () => {
    const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
    t.store.start(CONFIG)
    await settle()
    t.store.markAllRead()
    window.sessionStorage.setItem(notificationStorageKey('ex-9', 'persona-other'), '{"v":1,"readIds":[],"likes":[]}')
    window.sessionStorage.setItem('unrelated', 'keep')

    t.store.reset()
    expect(t.store.getSnapshot()).toMatchObject({ status: 'inactive', items: [], unread: 0 })
    expect(t.store.getSummary()).toEqual({ available: false, unread: 0 })
    expect(t.store.getAnnouncement().text).toBe('')
    expect(storedKeys()).toEqual([])
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep')
    expect(t.source.subscribers()).toBe(0)
    expect(t.source.calls.stopped).toBe(1)
  })

  it('a read that lands AFTER sign-out does not write anything back', async () => {
    const t = rig([mineP('m1', 2)])
    let resolveFeed: (posts: Post[]) => void = () => undefined
    t.fetchFeed.mockImplementationOnce(deferredFeed(resolve => { resolveFeed = resolve }))
    t.store.start(CONFIG)
    t.store.reset()
    resolveFeed([mineP('m1', 2), replyP('r1', 'm1')])
    await settle()
    expect(storedKeys()).toEqual([])
    expect(t.store.getSnapshot().items).toEqual([])
  })

  it('stop persists what changed (so a remount of the same viewer continues where it left off)', async () => {
    const t = rig([mineP('m1', 2)])
    const stop = t.store.start(CONFIG)
    await settle()
    stop()
    const stored = readPersisted(window.sessionStorage, notificationStorageKey(EXERCISE, ME))
    expect(stored.likes).toEqual([{ postId: 'm1', baseline: 2 }])
  })
})
