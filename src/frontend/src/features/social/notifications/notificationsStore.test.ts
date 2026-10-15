/**
 * features/social/notifications/notificationsStore.test.ts
 * ---------------------------------------------------------------------------
 * The notifications ENGINE (demo-polish F7, story 16 "Live and calm" + "Isolation"), driven
 * through `createNotificationsStore` with every side effect faked: the feed read, the shared
 * arrival source, the removed-post store, tab visibility, the clock and the browser storage
 * (jsdom's real `localStorage` / `sessionStorage`, cleared per test). Fake timers carry the
 * ~30 s read, the publish coalescing window and the announcement throttle.
 *
 * Covered: baseline vs live; arrivals that beat the baseline; the re-read that notices likes
 * (and only while the tab is visible); its jitter and its backoff on repeated failures; no
 * overlapping reads; the burst cost (one coalesced publish, one throttled announcement for 120
 * arrivals); the row cap; takedowns; "Mark all read" and its exercise- and persona-scoped
 * persistence in `localStorage` (surviving a tab reopen, merged across tabs, swept from BOTH
 * stores on sign-out); stop / restart / reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParticipantPostView, Post } from '../types/post'
import type { FeedStreamSource } from '../services/feedStreamSource'
import {
  createNotificationsStore,
  describeAnnouncement,
  nextPollDelayMs,
  type NotificationsDeps,
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
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_POLL_FIRST_MIN,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_POLL_JITTER,
  NOTIFICATION_PUBLISH_DELAY_MS,
  READ_IDS_CAP,
} from './notificationTypes'

const ME = 'persona-dreyes_fh'
const HANDLE = 'dreyes_fh'
const EXERCISE = 'ex-1'
const ACCOUNT = 'acct-dreyes'
const CONFIG: NotificationsSessionConfig = {
  exerciseId: EXERCISE,
  personaId: ME,
  accountId: ACCOUNT,
  handle: HANDLE,
}
/** This viewer's storage key. */
const KEY = notificationStorageKey(EXERCISE, ME, ACCOUNT)

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
const mentionP = (id: string, at?: string, by?: string): Post =>
  fullPost({
    id,
    text: `hello @${HANDLE} (${id})`,
    ...(at !== undefined ? { at } : {}),
    ...(by !== undefined ? { by } : {}),
  })

const EIGHT_AM = Date.UTC(2033, 8, 4, 8, 0, 0)
/** The n-th instant TWO minutes after 08:00Z: far enough apart that mentions are NOT a storm. */
const spread = (n: number): string => new Date(EIGHT_AM + n * 120_000).toISOString()
/** The n-th second after 08:00Z: close enough together that mentions ARE a burst. */
const burstAt = (n: number): string => new Date(EIGHT_AM + n * 1000).toISOString()

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

function rig(initial: Post[] = [], over: Partial<NotificationsDeps> = {}): Rig {
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
    // 0.5 is the centre of every jitter range: the first re-read lands at 62.5 % of the interval
    // and each later one at exactly the interval (the jitter has its own tests below).
    random: () => 0.5,
    // No start-up / catch-up jitter by default, so a test's `settle()` is the baseline read; the
    // jitter has its own tests (S-5).
    readJitterMs: 0,
    ...over,
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
  Object.keys(window.localStorage).filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))

/** Lets already-resolved promises (the feed read) settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0)
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

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

// ---------------------------------------------------------------------------

describe('describeAnnouncement', () => {
  const held = (reply: number, mention: number, like: number, events: number, repost = 0) =>
    ({ events, amountByType: { reply, mention, like, repost } })

  it('says one noun when only one kind arrived, counting what arrived', () => {
    expect(describeAnnouncement(held(1, 0, 0, 1))).toBe('1 new reply')
    expect(describeAnnouncement(held(14, 0, 0, 14))).toBe('14 new replies')
    expect(describeAnnouncement(held(0, 1, 0, 1))).toBe('1 new mention')
    expect(describeAnnouncement(held(0, 3, 0, 3))).toBe('3 new mentions')
    expect(describeAnnouncement(held(0, 0, 5, 1))).toBe('5 new likes')
    expect(describeAnnouncement(held(0, 0, 0, 1, 1))).toBe('1 new repost')
    expect(describeAnnouncement(held(0, 0, 0, 2, 2))).toBe('2 new reposts')
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
    window.localStorage.setItem(
      KEY,
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
      t.source.emit(mentionP(`p${index}`, spread(index)))
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

    const stored = readPersisted(window.localStorage, KEY)
    expect([...stored.readIds].sort()).toEqual(['p1', 'r1'])
    const keys = Object.keys(window.localStorage)
    expect(keys.filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))).toEqual([
      KEY,
    ])
  })

  it('survives a reload of the same persona in the same exercise', async () => {
    const first = rig([mineP('m1', 2), replyP('r1', 'm1')])
    const stop = await started(first)
    first.store.markAllRead()
    stop() // the browser keeps its localStorage; only the in-memory engine goes away

    const second = rig([mineP('m1', 2), replyP('r1', 'm1')])
    await started(second)
    expect(second.store.getSummary().unread).toBe(0)
    expect(second.store.getSnapshot().items[0]).toMatchObject({ id: 'reply:m1', unread: false })
  })

  it('does not leak to another persona: B reads nothing of A\'s, and starting B sweeps A\'s entry', async () => {
    const a = rig([mineP('m1'), replyP('r1', 'm1')])
    const stopA = await started(a)
    a.store.markAllRead()
    stopA()
    expect(readPersisted(window.localStorage, KEY).readIds).toEqual(['r1'])

    // Persona B sees a reply with the SAME id A marked read; for B it is unread.
    const b = rig([fullPost({ id: 'mb', by: 'persona-b' }), replyP('r1', 'mb')])
    const configB: NotificationsSessionConfig = { ...CONFIG, personaId: 'persona-b', handle: 'pb' }
    await started(b, configB)
    expect(b.store.getSummary().unread).toBe(1)
    // One browser holds one participant session: A's entry is dead weight and is gone, and B
    // owns its own key.
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(window.localStorage.getItem(notificationStorageKey(EXERCISE, 'persona-b', ACCOUNT)))
      .not.toBeNull()
  })

  it('does not leak to another exercise: the same persona starts unread there', async () => {
    const a = rig([mineP('m1'), replyP('r1', 'm1')])
    const stopA = await started(a)
    a.store.markAllRead()
    stopA()

    const other = rig([mineP('m1'), replyP('r1', 'm1')])
    await started(other, { ...CONFIG, exerciseId: 'ex-2' })
    expect(other.store.getSummary().unread).toBe(1)
  })

  it('does not leak to another ACCOUNT on the same persona (two humans on a shared org persona)', async () => {
    const first = rig([mineP('m1'), replyP('r1', 'm1')])
    const stopFirst = await started(first)
    first.store.markAllRead()
    stopFirst()

    const second = rig([mineP('m1'), replyP('r1', 'm1')])
    await started(second, { ...CONFIG, accountId: 'acct-someone-else' })
    expect(second.store.getSummary().unread).toBe(1) // the first account's marks are not theirs
    expect(window.localStorage.getItem(KEY)).toBeNull() // ... and are not left lying around
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
    window.localStorage.setItem(notificationStorageKey('ex-9', 'persona-other', ACCOUNT), '{"v":1,"readIds":[],"likes":[]}')
    window.localStorage.setItem('unrelated', 'keep')

    t.store.reset()
    expect(t.store.getSnapshot()).toMatchObject({ status: 'inactive', items: [], unread: 0 })
    expect(t.store.getSummary()).toEqual({ available: false, unread: 0 })
    expect(t.store.getAnnouncement().text).toBe('')
    expect(storedKeys()).toEqual([])
    expect(window.localStorage.getItem('unrelated')).toBe('keep')
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
    const stored = readPersisted(window.localStorage, KEY)
    // demo-feedback DF-19: each post of mine keeps a like record and a `repost:`-keyed one.
    expect(stored.likes).toEqual([
      { postId: 'm1', baseline: 2 },
      { postId: 'repost:m1', baseline: 0 },
    ])
  })
})

// ---------------------------------------------------------------------------
// W-1 / W-4 / S-4 (Gate-1 fold)
// ---------------------------------------------------------------------------

describe('"Mark all read" clears the badge however many events there are (W-1)', () => {
  it('after more than READ_IDS_CAP events the badge reads 0 and every row is read', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()

    // READ_IDS_CAP + 20 replies to one post (one row), then a pile of mentions (many rows).
    for (let index = 0; index < READ_IDS_CAP + 20; index += 1) {
      t.source.emit(replyP(`r${index}`, 'm1', `persona-${index % 5}`))
    }
    for (let index = 0; index < 30; index += 1) {
      t.source.emit(mentionP(`p${index}`, spread(index)))
    }
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSummary().unread).toBe(31)

    t.store.markAllRead()

    expect(t.store.getSummary().unread).toBe(0)
    const rows = t.store.getSnapshot().items
    expect(rows.length).toBe(31)
    expect(rows.every(row => !row.unread)).toBe(true)
    // What is WRITTEN is bounded; what is remembered live is not.
    const stored = readPersisted(window.localStorage, KEY)
    expect(stored.readIds.length).toBe(READ_IDS_CAP)
  })
})

describe('state lives in localStorage and survives a closed tab (W-4)', () => {
  const started = async (rigged: Rig) => {
    const stop = rigged.store.start(CONFIG)
    await settle()
    return stop
  }

  it('is written to localStorage, not sessionStorage', async () => {
    const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
    await started(t)
    t.store.markAllRead()
    const key = KEY
    expect(window.localStorage.getItem(key)).not.toBeNull()
    expect(window.sessionStorage.getItem(key)).toBeNull()
  })

  it('a simulated tab reopen (sessionStorage gone, localStorage kept) keeps read marks and baselines', async () => {
    const first = rig([mineP('m1', 5), replyP('r1', 'm1')])
    const stop = await started(first)
    first.store.markAllRead()
    stop()

    // Closing a tab discards its sessionStorage; localStorage outlives it.
    window.sessionStorage.clear()

    const reopened = rig([mineP('m1', 5), replyP('r1', 'm1')])
    await started(reopened)
    expect(reopened.store.getSummary().unread).toBe(0)
    expect(reopened.store.getSnapshot().items[0]).toMatchObject({ id: 'reply:m1', unread: false })

    // The like baseline came back too: likes since are counted from 5, not from scratch.
    reopened.feed.posts = [mineP('m1', 8), replyP('r1', 'm1')]
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(reopened.store.getSnapshot().items.find(row => row.type === 'like')).toMatchObject({
      count: 3,
      unread: true,
    })
  })

  it('sign-out sweeps BOTH stores, for any persona, and nothing else', async () => {
    const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
    await started(t)
    t.store.markAllRead()
    const other = notificationStorageKey('ex-9', 'persona-other', ACCOUNT)
    window.localStorage.setItem(other, '{"v":1,"readIds":[],"likes":[]}')
    // A leftover from a development build that kept the state per tab:
    window.sessionStorage.setItem(KEY, '{"v":1,"readIds":[],"likes":[]}')
    window.localStorage.setItem('unrelated', 'keep')
    window.sessionStorage.setItem('unrelated', 'keep')

    t.store.reset()

    const mine = (storage: Storage) =>
      Object.keys(storage).filter(key => key.startsWith(NOTIFICATION_STORAGE_PREFIX))
    expect(mine(window.localStorage)).toEqual([])
    expect(mine(window.sessionStorage)).toEqual([])
    expect(window.localStorage.getItem('unrelated')).toBe('keep')
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep')
  })

  it('also sweeps a store the caller injected as the state store', async () => {
    const memory = new Map<string, string>([[notificationStorageKey('ex-1', 'p', 'a'), '{}']])
    const injected = {
      get length() { return memory.size },
      key: (index: number) => [...memory.keys()][index] ?? null,
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
    } as unknown as Storage
    const t = rig([mineP('m1', 2), replyP('r1', 'm1')], { storage: () => injected })
    await started(t)
    expect(memory.has(notificationStorageKey('ex-1', 'p', 'a'))).toBe(false) // start swept the stale one
    t.store.markAllRead()
    expect(memory.has(KEY)).toBe(true)
    t.store.reset()
    expect(memory.size).toBe(0)
  })

  it('two tabs of one persona do not undo each other\'s "Mark all read"', async () => {
    const tabA = rig([mineP('m1', 2), replyP('r1', 'm1')])
    const tabB = rig([mineP('m1', 2), replyP('r1', 'm1')])
    await started(tabA)
    await started(tabB) // loaded BEFORE tab A marked anything

    tabA.store.markAllRead()
    // Tab B, still unaware, writes later because something of its own changed (a new post of mine).
    tabB.source.emit(mineP('fresh', 0))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)

    const stored = readPersisted(window.localStorage, KEY)
    expect(stored.readIds).toContain('r1') // tab A's mark survived tab B's write
    expect(stored.likes.map(record => record.postId).sort())
      .toEqual(['fresh', 'm1', 'repost:fresh', 'repost:m1'])
  })
})

describe('the re-read schedule: jitter and backoff (S-4)', () => {
  const INTERVAL = NOTIFICATION_POLL_INTERVAL_MS

  describe('nextPollDelayMs', () => {
    const delay = (over: Partial<Parameters<typeof nextPollDelayMs>[0]>, random = 0.5) =>
      nextPollDelayMs({
        intervalMs: INTERVAL,
        failures: 0,
        first: false,
        random: () => random,
        ...over,
      })

    it('puts the FIRST re-read at a random point between the minimum share and the full interval', () => {
      expect(delay({ first: true }, 0)).toBe(INTERVAL * NOTIFICATION_POLL_FIRST_MIN)
      expect(delay({ first: true }, 0.999)).toBeCloseTo(INTERVAL, -2)
      for (const random of [0, 0.1, 0.5, 0.9, 0.999]) {
        const value = delay({ first: true }, random)
        expect(value).toBeGreaterThanOrEqual(INTERVAL * NOTIFICATION_POLL_FIRST_MIN)
        expect(value).toBeLessThanOrEqual(INTERVAL)
      }
      expect(delay({ first: true }, 0.2)).not.toBe(delay({ first: true }, 0.8)) // really random
    })

    it('spreads every later tick +/- the jitter around the interval', () => {
      expect(delay({}, 0.5)).toBe(INTERVAL)
      expect(delay({}, 0)).toBe(Math.round(INTERVAL * (1 - NOTIFICATION_POLL_JITTER)))
      expect(delay({}, 0.999999)).toBeLessThanOrEqual(
        Math.round(INTERVAL * (1 + NOTIFICATION_POLL_JITTER)),
      )
      for (let step = 0; step <= 20; step += 1) {
        const value = delay({}, step / 20.0001)
        expect(value).toBeGreaterThanOrEqual(INTERVAL * (1 - NOTIFICATION_POLL_JITTER) - 1)
        expect(value).toBeLessThanOrEqual(INTERVAL * (1 + NOTIFICATION_POLL_JITTER) + 1)
      }
    })

    it('retries the first failure at the normal pace, then doubles per consecutive failure', () => {
      expect(delay({ failures: 1 })).toBe(INTERVAL)
      expect(delay({ failures: 2 })).toBe(INTERVAL * 2)
      expect(delay({ failures: 3 })).toBe(INTERVAL * 4)
      expect(delay({ failures: 4 })).toBe(INTERVAL * 8)
    })

    it('never backs off past about five minutes -- jitter included', () => {
      expect(delay({ failures: 5 })).toBe(NOTIFICATION_BACKOFF_CAP_MS)
      expect(delay({ failures: 50 })).toBe(NOTIFICATION_BACKOFF_CAP_MS)
      for (const random of [0, 0.5, 0.999]) {
        expect(delay({ failures: 50 }, random)).toBeLessThanOrEqual(NOTIFICATION_BACKOFF_CAP_MS)
      }
      expect(NOTIFICATION_BACKOFF_CAP_MS).toBe(300_000)
    })
  })

  it('the first re-read is NOT at the fixed interval, and later ones are not lockstep either', async () => {
    // random = 0: the earliest first tick (25 %) and the earliest later ticks (-15 %).
    const early = rig([mineP('m1', 1)], { random: () => 0 })
    early.store.start(CONFIG)
    await settle()
    expect(early.fetchFeed).toHaveBeenCalledTimes(1)
    await advance(INTERVAL * NOTIFICATION_POLL_FIRST_MIN - 1)
    expect(early.fetchFeed).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(early.fetchFeed).toHaveBeenCalledTimes(2) // 7.5 s after start
    await advance(INTERVAL * (1 - NOTIFICATION_POLL_JITTER) - 1)
    expect(early.fetchFeed).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(early.fetchFeed).toHaveBeenCalledTimes(3) // 25.5 s later, not 30
    early.store.reset()

    // random just under 1: the latest first tick (the full interval) and later ticks at +15 %.
    const late = rig([mineP('m1', 1)], { random: () => 0.999999 })
    late.store.start(CONFIG)
    await settle()
    await advance(INTERVAL - 5)
    expect(late.fetchFeed).toHaveBeenCalledTimes(1)
    await advance(5)
    expect(late.fetchFeed).toHaveBeenCalledTimes(2)
    await advance(INTERVAL * (1 + NOTIFICATION_POLL_JITTER) - 5)
    expect(late.fetchFeed).toHaveBeenCalledTimes(2)
    await advance(10)
    expect(late.fetchFeed).toHaveBeenCalledTimes(3)
  })

  it('backs off exponentially while reads keep failing, capped near 5 minutes, and recovers on success', async () => {
    const t = rig([mineP('m1', 1)])
    t.fetchFeed.mockRejectedValue(new Error('server down'))
    t.store.start(CONFIG)
    await settle() // read #1 fails at once

    const callsAt = async (elapsedMs: number) => {
      await advance(elapsedMs)
      return t.fetchFeed.mock.calls.length
    }
    // Centre jitter: first re-read at 62.5 % (18.75 s), then the gaps double after the 2nd failure.
    expect(await callsAt(18_750)).toBe(2) // failure #2 -> the next gap is 2 x interval
    expect(await callsAt(59_999)).toBe(2)
    expect(await callsAt(1)).toBe(3) // +60 s; failure #3 -> 4 x
    expect(await callsAt(119_999)).toBe(3)
    expect(await callsAt(1)).toBe(4) // +120 s; failure #4 -> 8 x
    expect(await callsAt(239_999)).toBe(4)
    expect(await callsAt(1)).toBe(5) // +240 s; failure #5 -> capped
    expect(await callsAt(299_999)).toBe(5)
    expect(await callsAt(1)).toBe(6) // +300 s (the cap)
    expect(await callsAt(299_999)).toBe(6)
    expect(await callsAt(1)).toBe(7) // still the cap

    // The server comes back: the very next read succeeds and the pace returns to normal.
    t.fetchFeed.mockResolvedValue([mineP('m1', 1), replyP('r1', 'm1')])
    expect(await callsAt(299_999)).toBe(7)
    expect(await callsAt(1)).toBe(8)
    await settle()
    expect(t.store.getSnapshot().status).toBe('ready')
    expect(await callsAt(NOTIFICATION_POLL_INTERVAL_MS)).toBe(9) // back to ~30 s
  })

  it('a hidden tab keeps the schedule going but reads nothing', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.start(CONFIG)
    await settle()
    t.visibility.set(false)
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 10)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    t.visibility.set(true) // the missed read is made up at once
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Gate-2 fold: W-1 (storms), W-2 (storage hygiene), W-4, S-4, S-5, S-7
// ---------------------------------------------------------------------------

describe('mention storms in the engine (SOC-071, W-1)', () => {
  it('120 mentions in a burst are ONE unread group; the announcement counts the mentions', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    const before = t.notifications.count

    for (let index = 0; index < 120; index += 1) {
      t.source.emit(mentionP(`p${index}`, burstAt(index % 50), `persona-${index % 42}`))
    }
    // The first is spoken at once; the other 119 are held.
    expect(t.store.getAnnouncement().text).toBe('1 new mention')
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)

    const snapshot = t.store.getSnapshot()
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({ type: 'mention', count: 120, actorCount: 42, unread: true })
    expect(snapshot.unread).toBe(1) // ONE group
    expect(t.store.getSummary().unread).toBe(1) // ... so the badge says 1, not 99+

    await advance(NOTIFICATION_ANNOUNCE_THROTTLE_MS)
    expect(t.store.getAnnouncement().text).toBe('119 new mentions')
    // Calm: the whole burst cost 3 notifications (first line, one publish, the held line).
    expect(t.notifications.count - before).toBe(3)
  })

  it('a storm is read by "Mark all read" like any other group', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    for (let index = 0; index < 20; index += 1) t.source.emit(mentionP(`p${index}`, burstAt(index)))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSummary().unread).toBe(1)
    t.store.markAllRead()
    expect(t.store.getSummary().unread).toBe(0)
    expect(t.store.getSnapshot().items[0]).toMatchObject({ count: 20, unread: false })
  })

  it('three spread-out mentions are three rows and three unread', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    for (let index = 0; index < 3; index += 1) t.source.emit(mentionP(`p${index}`, spread(index * 5)))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSnapshot().items).toHaveLength(3)
    expect(t.store.getSummary().unread).toBe(3)
  })

  it('a burst already in the feed at the baseline is one row too (and not announced)', async () => {
    const burst = Array.from({ length: 30 }, (_, index) => mentionP(`p${index}`, burstAt(index)))
    const t = rig([mineP('m1'), ...burst])
    t.store.start(CONFIG)
    await settle()
    expect(t.store.getSnapshot().items).toHaveLength(1)
    expect(t.store.getSummary().unread).toBe(1)
    expect(t.store.getAnnouncement().text).toBe('')
  })
})

describe('storage hygiene (W-2)', () => {
  const started = async (rigged: Rig, config = CONFIG) => {
    const stop = rigged.store.start(config)
    await settle()
    return stop
  }
  const keysOf = (storage: Storage) =>
    Object.keys(storage).filter(key => key.startsWith(`${NOTIFICATION_STORAGE_PREFIX}:`))

  it('start() sweeps every notification entry except the current viewer\'s', async () => {
    const other = notificationStorageKey('ex-old', 'persona-old', 'acct-old')
    const lookalike = `${NOTIFICATION_STORAGE_PREFIX}-not-ours`
    window.localStorage.setItem(other, '{"v":1,"readIds":["x"],"likes":[]}')
    window.localStorage.setItem(KEY, '{"v":1,"readIds":["r1"],"likes":[]}')
    window.localStorage.setItem('unrelated', 'keep')
    window.localStorage.setItem(lookalike, 'keep')
    // A leftover from a build that kept the state per tab -- even the CURRENT key is stale there.
    window.sessionStorage.setItem(KEY, '{"v":1,"readIds":[],"likes":[]}')

    const t = rig([mineP('m1'), replyP('r1', 'm1')])
    await started(t)

    expect(window.localStorage.getItem(other)).toBeNull()
    expect(keysOf(window.localStorage)).toEqual([KEY]) // the current one is kept ...
    expect(t.store.getSummary().unread).toBe(0) // ... and READ: r1 was marked read
    expect(keysOf(window.sessionStorage)).toEqual([])
    expect(window.localStorage.getItem('unrelated')).toBe('keep')
    expect(window.localStorage.getItem(lookalike)).toBe('keep')
  })

  it('the account id is part of the key (two humans on a shared org persona do not share marks)', () => {
    expect(notificationStorageKey(EXERCISE, ME, 'acct-a')).not.toBe(
      notificationStorageKey(EXERCISE, ME, 'acct-b'),
    )
    expect(KEY).toContain(encodeURIComponent(ACCOUNT))
  })

  describe('a `storage` event from another tab', () => {
    const fire = (init: StorageEventInit) => {
      window.dispatchEvent(new StorageEvent('storage', init))
    }

    it('removing the current key ends the session WITHOUT writing the stale state back', async () => {
      const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
      await started(t)
      t.store.markAllRead()
      expect(window.localStorage.getItem(KEY)).not.toBeNull()

      window.localStorage.removeItem(KEY) // what the other tab's sign-out did
      fire({ key: KEY, newValue: null, storageArea: window.localStorage })

      expect(t.store.getSummary()).toEqual({ available: false, unread: 0 })
      expect(t.store.getSnapshot().status).toBe('inactive')
      expect(t.source.subscribers()).toBe(0)
      expect(t.source.calls.stopped).toBe(1)
      // Nothing this tab does afterwards can resurrect the entry.
      t.source.emit(mineP('fresh'))
      await advance(NOTIFICATION_POLL_INTERVAL_MS * 3)
      expect(window.localStorage.getItem(KEY)).toBeNull()
      expect(t.fetchFeed).toHaveBeenCalledTimes(1) // ... and it stopped reading
    })

    it('clearing the whole store does the same', async () => {
      const t = rig([mineP('m1')])
      await started(t)
      fire({ key: null, newValue: null, storageArea: window.localStorage })
      expect(t.store.getSummary().available).toBe(false)
    })

    it('ignores another viewer\'s key, an UPDATE of ours, and another store', async () => {
      const t = rig([mineP('m1')])
      await started(t)
      fire({ key: notificationStorageKey('ex-1', 'someone', 'else'), newValue: null, storageArea: window.localStorage })
      fire({ key: KEY, newValue: '{"v":1,"readIds":[],"likes":[]}', storageArea: window.localStorage })
      fire({ key: KEY, newValue: null, storageArea: window.sessionStorage })
      expect(t.store.getSummary().available).toBe(true)
    })

    it('stops listening once the session has stopped', async () => {
      const t = rig([mineP('m1')])
      const stop = await started(t)
      stop()
      const before = t.notifications.count
      fire({ key: KEY, newValue: null, storageArea: window.localStorage })
      expect(t.notifications.count).toBe(before)
    })
  })
})

describe('sign-out only wipes what this tab owns (W-4)', () => {
  it('a STAFF tab\'s sign-out (it never ran a notifications session) leaves participant state alone', async () => {
    // The participant's state, written by a participant tab of the same browser.
    const participant = rig([mineP('m1', 2), replyP('r1', 'm1')])
    participant.store.start(CONFIG)
    await settle()
    participant.store.markAllRead()
    expect(window.localStorage.getItem(KEY)).not.toBeNull()

    // A staff tab: this store never started. `endSession` runs its reset.
    const staff = rig()
    const before = staff.notifications.count
    staff.store.reset()

    expect(window.localStorage.getItem(KEY)).not.toBeNull()
    expect(staff.notifications.count).toBe(before) // ... and it published nothing either
    expect(participant.store.getSummary().available).toBe(true) // the participant tab runs on
  })

  it('a participant tab\'s sign-out (it ran a session) sweeps the state', async () => {
    const participant = rig([mineP('m1', 2), replyP('r1', 'm1')])
    participant.store.start(CONFIG)
    await settle()
    participant.store.markAllRead()

    participant.store.reset()

    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(participant.store.getSummary().available).toBe(false)
  })

  it('still sweeps after the session was stopped (the component unmounted before sign-out finished)', async () => {
    const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
    const stop = t.store.start(CONFIG)
    await settle()
    t.store.markAllRead()
    stop()
    expect(window.localStorage.getItem(KEY)).not.toBeNull() // stop persists
    t.store.reset()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  // Copilot review on #484: the ownership flag must not outlive the sweep it licensed. A tab that
  // once ran a participant session and signed out is, from then on, a tab with nothing to wipe --
  // and `reset()` now runs on every sign-in too (`resetClientSession`), so it is called often.
  describe('the sweep spends the ownership (a tab that signed out owns nothing)', () => {
    /** Another tab of the same browser: its own store instance, the same `localStorage`. */
    async function anotherTabSignedIn() {
      const other = rig([mineP('m1', 2), replyP('r1', 'm1')])
      other.store.start(CONFIG)
      await settle()
      other.store.markAllRead()
      expect(window.localStorage.getItem(KEY)).not.toBeNull()
      return other
    }

    it('participant session -> reset (sweeps) -> a second reset leaves another tab\'s keys alone', async () => {
      const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
      t.store.start(CONFIG)
      await settle()
      t.store.markAllRead()
      t.store.reset() // the participant sign-out: sweeps
      expect(window.localStorage.getItem(KEY)).toBeNull()

      const other = await anotherTabSignedIn() // a participant signs in, in ANOTHER tab
      const before = t.notifications.count
      t.store.reset() // this tab is a staff tab now: its sign-out has nothing of its own to wipe

      expect(window.localStorage.getItem(KEY)).not.toBeNull()
      expect(other.store.getSummary().available).toBe(true)
      expect(t.notifications.count).toBe(before) // ... and it published nothing either
    })

    it('a sign-out followed by a sign-in\'s reset does not sweep a participant signed in elsewhere', async () => {
      const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
      t.store.start(CONFIG)()
      await settle()
      t.store.reset() // sign-out
      const other = await anotherTabSignedIn()

      t.store.reset() // the next sign-in (staff) in this tab: `runSessionResets()`

      expect(window.localStorage.getItem(KEY)).not.toBeNull()
      expect(other.store.getSummary().available).toBe(true)
    })

    it('a session started after a reset re-arms the ownership: its next sign-out sweeps again', async () => {
      const t = rig([mineP('m1', 2), replyP('r1', 'm1')])
      t.store.start(CONFIG)
      await settle()
      t.store.reset()
      t.store.reset() // spent: a no-op

      t.store.start(CONFIG) // this tab runs a participant session again
      await settle()
      t.store.markAllRead()
      expect(window.localStorage.getItem(KEY)).not.toBeNull()
      t.store.reset()

      expect(window.localStorage.getItem(KEY)).toBeNull()
      expect(t.store.getSummary().available).toBe(false)
    })
  })
})

describe('announcement hygiene (S-4)', () => {
  it('the throttle is about 12 s, so it is not in lock-step with the new-posts pill\'s 3 s', () => {
    expect(NOTIFICATION_ANNOUNCE_THROTTLE_MS).toBe(12_000)
  })

  it('"Mark all read" drops what was HELD, so it is not spoken after "all read"', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.source.emit(replyP('r1', 'm1'))
    t.source.emit(replyP('r2', 'm1', 'persona-sam'))
    t.source.emit(replyP('r3', 'm1', 'persona-kim'))
    expect(t.store.getAnnouncement().text).toBe('1 new reply') // 2 more are held
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)

    t.store.markAllRead()
    expect(t.store.getAnnouncement().text).toBe('All notifications marked as read')

    await advance(NOTIFICATION_ANNOUNCE_THROTTLE_MS * 2)
    expect(t.store.getAnnouncement().text).toBe('All notifications marked as read')
  })
})

describe('read jitter and the shell pause (S-5)', () => {
  const JITTERY = { readJitterMs: 2_000, random: () => 0.5 } // every jitter is exactly 1 s

  it('the baseline read waits a random 0-2 s', async () => {
    const t = rig([mineP('m1', 1)], JITTERY)
    t.store.start(CONFIG)
    await advance(999)
    expect(t.fetchFeed).toHaveBeenCalledTimes(0)
    expect(t.store.getSnapshot().status).toBe('loading')
    await advance(1)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    expect(t.store.getSnapshot().status).toBe('ready')
  })

  it('arrivals before the delayed baseline are still held and replayed', async () => {
    const t = rig([mineP('m1')], JITTERY)
    t.store.start(CONFIG)
    t.source.emit(replyP('r1', 'm1')) // inside the 1 s wait
    await advance(1_000)
    expect(t.store.getSnapshot().items.map(item => item.id)).toEqual(['reply:m1'])
  })

  it('stopping inside the baseline wait reads nothing', async () => {
    const t = rig([mineP('m1')], JITTERY)
    t.store.start(CONFIG)()
    await advance(60_000)
    expect(t.fetchFeed).not.toHaveBeenCalled()
  })

  it('the catch-up read after a hidden tab is jittered, and the schedule is re-set behind it', async () => {
    const t = rig([mineP('m1', 1)], JITTERY)
    t.store.start(CONFIG)
    await advance(1_000) // baseline at 1 s
    t.visibility.set(false)
    await advance(17_750) // t = 18.75 s: the first tick lands while hidden -> missed
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)

    await advance(1_250) // t = 20 s
    t.visibility.set(true)
    await advance(999)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1) // not immediate
    await advance(1) // t = 21 s: the jittered catch-up read
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)

    // The OLD timer (48.75 s) is gone: the next read is a full interval after the catch-up.
    await advance(NOTIFICATION_POLL_INTERVAL_MS - 1_001) // t = 49.999 s
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
    await advance(1_001) // t = 51 s = 21 s + 30 s
    expect(t.fetchFeed).toHaveBeenCalledTimes(3)
  })

  it('holds the periodic re-read while the shell overlay is up, and makes it up when it clears', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.start(CONFIG)
    await settle()
    t.store.setPaused(true)
    t.feed.posts = [mineP('m1', 4)]
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 4)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    expect(t.store.getSnapshot().items).toEqual([])

    t.store.setPaused(false)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
    expect(t.store.getSnapshot().items[0]).toMatchObject({ id: 'like:m1', count: 3 })
  })

  it('pausing with nothing missed, or twice, does nothing; realtime arrivals still land', async () => {
    const t = rig([mineP('m1')])
    t.store.start(CONFIG)
    await settle()
    t.store.setPaused(true)
    t.store.setPaused(true)
    t.store.setPaused(false)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)

    t.store.setPaused(true)
    t.source.emit(replyP('r1', 'm1'))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSummary().unread).toBe(1)
  })

  it('setPaused with no session starts nothing and does not throw', () => {
    const t = rig()
    expect(() => t.store.setPaused(true)).not.toThrow()
    expect(t.store.getSummary().available).toBe(false)
    expect(t.fetchFeed).not.toHaveBeenCalled()
  })

  it('a pause that lands inside the jittered baseline wait holds the baseline too', async () => {
    const t = rig([mineP('m1', 1)], JITTERY)
    t.store.start(CONFIG)
    await advance(500)
    t.store.setPaused(true)
    await advance(60_000) // the baseline would have landed at 1 s
    expect(t.fetchFeed).not.toHaveBeenCalled()
    expect(t.store.getSnapshot().status).toBe('loading')

    t.store.setPaused(false)
    await advance(1_000) // the jittered make-up
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    expect(t.store.getSnapshot().status).toBe('ready')
  })
})

// Copilot review on #484: the engine's `OverlayHold` is a CHILD of the engine, so its effect
// (`setPaused`) runs BEFORE the engine's `start()`. The hold is therefore the store's own state,
// remembered with no session and applied to whichever session starts next.
describe('a session that STARTS while the shell overlay is already up', () => {
  const JITTERY = { readJitterMs: 2_000, random: () => 0.5 } // every jitter is exactly 1 s

  it('starts held: no baseline read, no periodic re-read, until the overlay clears -- then exactly the made-up read', async () => {
    const t = rig([mineP('m1', 1), replyP('r1', 'm1')])
    t.store.setPaused(true) // OverlayHold's effect, before any session exists
    t.store.start(CONFIG)
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 4)

    expect(t.fetchFeed).not.toHaveBeenCalled()
    expect(t.store.getSnapshot().status).toBe('loading')
    expect(t.store.getSummary()).toEqual({ available: true, unread: 0 })

    t.store.setPaused(false)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1) // the baseline, made up -- not also a periodic one
    expect(t.store.getSnapshot().status).toBe('ready')
    expect(t.store.getSummary().unread).toBe(1)

    // ... and the schedule carries on from the make-up read, one interval later.
    await advance(NOTIFICATION_POLL_INTERVAL_MS - 1)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
  })

  it('makes the baseline up with the same jitter as any read made up after a pause', async () => {
    const t = rig([mineP('m1', 1)], JITTERY)
    t.store.setPaused(true)
    t.store.start(CONFIG)
    await advance(60_000)
    expect(t.fetchFeed).not.toHaveBeenCalled()

    t.store.setPaused(false)
    await advance(999)
    expect(t.fetchFeed).not.toHaveBeenCalled()
    await advance(1)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
  })

  it('still holds realtime arrivals that land while it is held, and replays them after the baseline', async () => {
    const t = rig([mineP('m1')])
    t.store.setPaused(true)
    t.store.start(CONFIG)
    t.source.emit(replyP('r1', 'm1')) // realtime is not held
    await advance(NOTIFICATION_POLL_INTERVAL_MS)
    expect(t.store.getSummary().unread).toBe(0) // not classifiable until my posts are known

    t.store.setPaused(false)
    await settle()
    expect(t.store.getSnapshot().items.map(item => item.id)).toEqual(['reply:m1'])
    expect(t.store.getSummary().unread).toBe(1)
  })

  it('cleared while the tab is hidden: the made-up read waits for the tab to be visible', async () => {
    const t = rig([mineP('m1', 1)])
    t.visibility.set(false)
    t.store.setPaused(true)
    t.store.start(CONFIG)
    t.store.setPaused(false)
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 2)
    expect(t.fetchFeed).not.toHaveBeenCalled()

    t.visibility.set(true)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    expect(t.store.getSnapshot().status).toBe('ready')
  })

  it('a hold that was lifted before the session started changes nothing', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.setPaused(true)
    t.store.setPaused(false) // OverlayHold's cleanup
    t.store.start(CONFIG)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
    expect(t.store.getSnapshot().status).toBe('ready')
  })

  it('an identity change while held (the engine re-runs start()) starts the NEW session held too', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.start(CONFIG)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)

    t.store.setPaused(true)
    // The eligible persona changed: the engine stops the old session and starts the new one.
    t.store.start({ ...CONFIG, personaId: 'persona-other', handle: 'other_fh' })
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 4)
    expect(t.fetchFeed).toHaveBeenCalledTimes(1) // the new session read nothing behind the page
    expect(t.store.getSnapshot().status).toBe('loading')

    t.store.setPaused(false)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(2)
    expect(t.store.getSnapshot().status).toBe('ready')
  })

  it('stop and restart while held (StrictMode\'s start / stop / start) leaves one held session', async () => {
    const t = rig([mineP('m1', 1)])
    t.store.setPaused(true)
    t.store.start(CONFIG)()
    t.store.start(CONFIG)
    await advance(NOTIFICATION_POLL_INTERVAL_MS * 2)
    expect(t.fetchFeed).not.toHaveBeenCalled()

    t.store.setPaused(false)
    await settle()
    expect(t.fetchFeed).toHaveBeenCalledTimes(1)
  })
})

describe('the summary is referentially stable (S-7)', () => {
  it('returns the SAME object across publishes where the unread count did not change', async () => {
    const t = rig([mineP('m1'), replyP('r1', 'm1')])
    t.store.start(CONFIG)
    await settle()
    const first = t.store.getSummary()
    expect(first).toEqual({ available: true, unread: 1 })

    // Publishes that change the snapshot but not the unread count:
    t.source.emit(mineP('fresh')) // a new post of mine registers (a visible change, no row)
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    t.feed.posts = [mineP('m1'), replyP('r1', 'm1'), mineP('fresh', 0)]
    await advance(NOTIFICATION_POLL_INTERVAL_MS) // a re-read publishes too
    expect(t.store.getSummary()).toBe(first)

    // A real change makes a new object ...
    t.store.markAllRead()
    const read = t.store.getSummary()
    expect(read).not.toBe(first)
    expect(read).toEqual({ available: true, unread: 0 })
    // ... which is then stable in turn.
    t.source.emit(mineP('another'))
    await advance(NOTIFICATION_PUBLISH_DELAY_MS)
    expect(t.store.getSummary()).toBe(read)
  })
})
