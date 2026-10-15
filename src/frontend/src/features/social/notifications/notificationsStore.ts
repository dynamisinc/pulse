/**
 * features/social/notifications/notificationsStore.ts
 * ---------------------------------------------------------------------------
 * The notifications ENGINE and its store (demo-polish F7, story 16; SOC-070 lite,
 * SOC-071, NFR-001/002/003, COR-001/053). Participant world -- a framework-free
 * external store that React reads through `useSyncExternalStore` (see
 * `useNotifications.ts`); no UI, no COBRA, no MUI, no wall-clock.
 *
 * WHY A MODULE STORE. The unread badge lives in the nav rail (visible on every route) and
 * the rows live on `/notifications`; one engine has to feed both, and it has to keep
 * running while the viewer is on Home. A React context would have to be mounted above
 * both, whereas a store the rail and the page both subscribe to needs no shared ancestor
 * (and the rail stays renderable on its own). It is the same shape as `ownPostStore` /
 * `removedPosts`: a leaf singleton, reset on sign-out.
 *
 * ONE SESSION AT A TIME. `start(config)` begins a session for an eligible viewer (a
 * persona-bound, interactive, not read-only participant -- `NotificationsEngine` decides)
 * and returns its idempotent `stop`. A session:
 *
 *   1. loads that viewer's persisted state (`notificationStorage`, in `localStorage`: read
 *      ids + like baselines under an exercise- AND persona-scoped key) and builds a
 *      {@link NotificationModel};
 *   2. subscribes to the SHARED arrival source (`defaultArrivalSource`: SignalR
 *      `PostReceived` with its polling fallback in live mode, the in-tab `postStore` under
 *      mock data) -- it opens no connection of its own; the source is ref-counted, so this
 *      session is one more holder of the transport the feed's pill and the thread view
 *      already share. Replies and mentions therefore arrive in real time;
 *   3. reads the exercise-scoped feed WITH replies (`resolveFeed('all', { includeReplies:
 *      true })` -- the session binds the exercise server-side, COR-001) once, to establish
 *      the baseline, and then about every 30 s WHILE THE TAB IS VISIBLE (jittered, and backed
 *      off after repeated failures -- see {@link nextPollDelayMs}). That re-read is how a
 *      like is noticed: B3 adds no reaction broadcast and `PostReceived` never carries a
 *      like, so a like is only ever visible as a count change on one of the viewer's own
 *      posts. A tick that lands while the tab is hidden is skipped, and the missed read is
 *      made up the moment the tab is visible again. The same goes for the shell's pause /
 *      EndEx overlay (below), which holds the baseline read as well as the periodic ones;
 *   4. watches `removedPosts` and drops a taken-down post from the list;
 *   5. publishes immutable snapshots (below) and a polite announcement string;
 *   6. (demo-feedback DF-19) subscribes to the default ENGAGEMENT source
 *      (`defaultEngagementChangeSource`: the hub's `PostEngagementChanged` live, the mock adapter
 *      under mock data) and offers every frame to the model, which applies a frame for one of MY
 *      posts only when its `version` is newer than the last one applied to that post. A like or a
 *      repost on my post is therefore noticed THE MOMENT it lands -- not on the next 30 s read --
 *      and a replayed or stale frame never notifies twice. Frames are not held while the tab is
 *      hidden (the badge updates live there too); frames that beat the baseline read are held
 *      (newest per post) and replayed after it, like early arrivals. The 30 s re-read stays as the
 *      safety net for a transport that is polling, where there are no frames.
 *
 * ARRIVALS BEFORE THE BASELINE are held in a bounded buffer and replayed after the first
 * read, in order: a reply cannot be classified until the viewer's own posts are known, and
 * a reply that beat the baseline must not be lost.
 *
 * LIVE AND CALM (SOC-071, NFR-002).
 *  - PUBLISHING IS COALESCED. An arrival that changes nothing (the overwhelming majority
 *    in a burst: other people's unrelated posts) schedules nothing. One that does schedules
 *    ONE snapshot {@link NOTIFICATION_PUBLISH_DELAY_MS} later; any number of further changes
 *    inside the window ride on the same snapshot. The rail and the page re-render at most a
 *    few times a second, whatever the arrival rate.
 *  - ROWS ARE GROUPS (see `notificationModel` / `notificationTypes`): the row count is the
 *    number of distinct subject posts, and only the newest {@link MAX_NOTIFICATION_ROWS} are
 *    handed to the page (the rest are counted, not drawn).
 *  - ANNOUNCEMENTS ARE THROTTLED, like the new-posts pill's: the first new item is spoken at
 *    once ("1 new reply"); more inside {@link NOTIFICATION_ANNOUNCE_THROTTLE_MS} are held and
 *    spoken together when it ends ("14 new replies"). Nothing is announced for the
 *    baseline -- the badge says what was already there.
 *
 * THE SHELL OVERLAY HOLD (`setPaused`). While the participant shell's pause / EndEx overlay is
 * up the world is frozen and there is nothing to find, so every FEED READ holds -- the baseline
 * and the periodic ones alike -- and a held read is noted as missed (`missedWhileHidden`, the
 * hidden-tab flag) and made up, jittered, when the overlay clears (`catchUpRead`). Realtime
 * arrivals are not held. The hold is the STORE's state, not the session's: the engine's
 * `OverlayHold` is a child of the engine, so its effect runs BEFORE the engine's `start()` and
 * there is no session to tell yet. The last request is therefore remembered with or without a
 * session (`overlayHeld`) and every session is created with it -- a channel that mounts while
 * the overlay is up, and a session restarted by an identity change while it stays up, both
 * start held.
 *
 * ISOLATION (COR-001). The only data read is the session's own exercise-scoped feed and the
 * shared arrival source; the storage key carries the exercise id and the persona id; a
 * session never reads another persona's entry.
 *
 * SIGN-OUT. `reset()` stops any session WITHOUT writing (a late-resolving read after
 * sign-out must not re-persist), sweeps every notification key from BOTH `localStorage` (where
 * the state lives, next to the persisted tokens) and `sessionStorage` (where an earlier
 * development build kept it) and publishes the inactive state. It sweeps only in a tab that
 * OWNS notification state -- one that has started a session since its last sweep -- and the
 * sweep spends that ownership: a tab that signed out owns nothing, so its next `reset()` (a
 * later sign-in's, or a staff sign-out in the same tab) cannot wipe a participant who is
 * signed in in ANOTHER tab of the browser; only a newly started session re-arms it. It is
 * registered with `core/auth/sessionReset` below, the way the controller composer registers
 * its drafts: `core/` cannot import this feature, and a browser-lived singleton must not hand
 * one sign-in's baseline to the next.
 *
 * ARRIVALS THAT DO NOT FIT. The model is bounded (`GROUPS_CAP` rows, `MINE_CAP` own posts), so
 * a long session costs the same per snapshot as a short one. WHAT THE RE-READ CAN SEE is bounded
 * too, by the server: the feed is the newest 200 posts (`PostReadService.FeedTake`), about the
 * last 100 s under a 120-posts/min burst. Likes on, and replies after a reload to, posts that
 * have scrolled out of that window are not seen; live replies still arrive through the
 * realtime path. The real fix is a backend own-posts read, filed as a follow-up.
 *
 * TESTABILITY. `createNotificationsStore(deps)` takes every side effect as a dependency
 * (the feed read, the arrival source, storage, the clock, visibility, the intervals); the
 * app uses the default singleton {@link notificationsStore}. Defaults are read lazily, on
 * `start`, so merely importing this module touches neither the network nor the store.
 */

import { registerSessionReset } from '@/core/auth/sessionReset'
import { scenarioNow } from '@/core/clock'
import type { Post, ParticipantPostView } from '../types/post'
import { resolveFeed } from '../services/feedService'
import { defaultArrivalSource, type FeedStreamSource } from '../services/feedStreamSource'
import {
  defaultEngagementChangeSource,
  type EngagementChangeSource,
  type PostEngagementChangedEvent,
} from '../services/realtimeFeed'
import { toParticipantView } from '../services/postService'
import { removedPosts } from '../services/removedPosts'
import { NotificationModel } from './notificationModel'
import {
  clearAllNotificationStorage,
  getPersistentStorage,
  getSessionStorage,
  mergeForWrite,
  notificationStorageKey,
  readPersisted,
  writePersisted,
} from './notificationStorage'
import {
  MAX_NOTIFICATION_ROWS,
  NOTIFICATION_ANNOUNCE_THROTTLE_MS,
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_POLL_FIRST_MIN,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_POLL_JITTER,
  NOTIFICATION_READ_JITTER_MS,
  NOTIFICATION_PUBLISH_DELAY_MS,
  PRELOAD_BUFFER_CAP,
  type NotificationEvent,
  type NotificationItem,
  type NotificationType,
} from './notificationTypes'

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Where the engine is: nothing running, first read in flight, ready, or the first read failed. */
export type NotificationsStatus = 'inactive' | 'loading' | 'ready' | 'error'

/** Everything the page renders. Immutable; replaced (never mutated) on each publish. */
export interface NotificationsSnapshot {
  readonly status: NotificationsStatus
  /** The newest rows, newest first, at most {@link MAX_NOTIFICATION_ROWS}. */
  readonly items: readonly NotificationItem[]
  /** How many further (older) rows exist but are not listed. */
  readonly hiddenCount: number
  /** Unread ROWS across the whole list (listed or not): what the badge shows. */
  readonly unread: number
}

/** What the nav rail needs: whether the bell exists at all, and its count. */
export interface NotificationsSummary {
  /** True only while a session runs -- the bell is ABSENT, not disabled, otherwise (D1-011). */
  readonly available: boolean
  readonly unread: number
}

/** The latest polite announcement; `seq` changes on every one so repeats are re-spoken. */
export interface NotificationsAnnouncement {
  readonly seq: number
  readonly text: string
}

/** Who a session is for. */
export interface NotificationsSessionConfig {
  readonly exerciseId: string
  readonly personaId: string
  /** The signed-in account (part of the storage key: one persona, one entry per account). */
  readonly accountId: string
  /** The persona's handle, without the `@` -- what a mention is matched against. */
  readonly handle: string
}

/** The slice of a `storage` event the store reads (fired in other tabs, never the writer). */
export interface StorageChange {
  /** The key that changed, or `null` when the whole store was cleared. */
  readonly key: string | null
  /** The new value, `null` when the key was removed. */
  readonly newValue: string | null
  /** Which store changed (`localStorage`, `sessionStorage`), `null` if unknown. */
  readonly storageArea: Storage | null
}

/** The side effects the store depends on (see the module header). */
export interface NotificationsDeps {
  /** Reads the exercise's feed INCLUDING replies. */
  readonly fetchFeed: () => Promise<readonly Post[]>
  /** The shared arrival source (unfiltered: replies included). */
  readonly source: () => FeedStreamSource
  /** The `PostEngagementChanged` source (DF-19): live counts for my posts' likes and reposts. */
  readonly engagement: () => EngagementChangeSource
  /** The session's taken-down post ids. */
  readonly removed: {
    getAll(): ReadonlySet<string>
    has(postId: string): boolean
    subscribe(listener: () => void): () => void
  }
  /** Where the state lives (default `localStorage`; see `notificationStorage`). */
  readonly storage: () => Storage | undefined
  /** Every store a sign-out sweeps, besides `storage` (default: local AND session storage). */
  readonly sweepStorages: () => readonly (Storage | undefined)[]
  /** A number in [0, 1): the poll jitter source (default `Math.random`). */
  readonly random: () => number
  /** The current SCENARIO instant, ISO (never wall-clock). */
  readonly now: () => string
  readonly isVisible: () => boolean
  /** Subscribes to tab visibility changes; returns the unsubscribe. */
  readonly onVisibilityChange: (listener: () => void) => () => void
  readonly pollIntervalMs: number
  /** Up to this long (random) before the baseline read and the visibility catch-up read. */
  readonly readJitterMs: number
  /** Subscribes to `storage` events from OTHER tabs; returns the unsubscribe. */
  readonly onStorageChange: (listener: (change: StorageChange) => void) => () => void
  readonly publishDelayMs: number
  readonly announceThrottleMs: number
}

export interface NotificationsStore {
  start(config: NotificationsSessionConfig): () => void
  subscribe(listener: () => void): () => void
  getSnapshot(): NotificationsSnapshot
  getSummary(): NotificationsSummary
  getAnnouncement(): NotificationsAnnouncement
  /** Marks every current row read and persists it. A no-op with no session. */
  markAllRead(): void
  /**
   * Holds (true) or resumes (false) the feed reads -- the baseline and the periodic re-read --
   * while the shell's pause / EndEx overlay is up: the world is frozen and there is nothing to
   * find. Held reads are made up, jittered, on resume. Realtime arrivals are unaffected. The
   * request is remembered when there is NO session yet, and the next session to start starts
   * with it (the engine's overlay hook runs before its `start()`).
   */
  setPaused(paused: boolean): void
  /**
   * Sign-out: stop, forget, sweep storage -- but only in a tab that has run a notifications
   * session since it last swept, so a STAFF tab's sign-out cannot wipe a participant's state
   * (and neither can a tab that has already signed its own participant out).
   */
  reset(): void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INACTIVE_SNAPSHOT: NotificationsSnapshot = {
  status: 'inactive',
  items: [],
  hiddenCount: 0,
  unread: 0,
}
const UNAVAILABLE_SUMMARY: NotificationsSummary = { available: false, unread: 0 }
const NO_ANNOUNCEMENT: NotificationsAnnouncement = { seq: 0, text: '' }

/** The spoken noun per type: singular, plural. */
const SPOKEN: Record<NotificationType, readonly [string, string]> = {
  reply: ['reply', 'replies'],
  mention: ['mention', 'mentions'],
  like: ['like', 'likes'],
  repost: ['repost', 'reposts'],
}

/** What was held back for the next spoken announcement. */
export interface HeldEvents {
  events: number
  readonly amountByType: Record<NotificationType, number>
}

function emptyHeld(): HeldEvents {
  return { events: 0, amountByType: { reply: 0, mention: 0, like: 0, repost: 0 } }
}

/** "1 new reply" / "14 new replies" / "3 new notifications" -- names no one (no cast needed). */
export function describeAnnouncement(held: HeldEvents): string {
  const types = (Object.keys(held.amountByType) as NotificationType[])
    .filter(type => held.amountByType[type] > 0)
  const [only] = types
  if (types.length === 1 && only !== undefined) {
    const amount = held.amountByType[only]
    const [singular, plural] = SPOKEN[only]
    return `${amount} new ${amount === 1 ? singular : plural}`
  }
  return `${held.events} new ${held.events === 1 ? 'notification' : 'notifications'}`
}

/** Inputs to {@link nextPollDelayMs}. */
export interface PollDelayInput {
  readonly intervalMs: number
  /** Consecutive failed reads so far (0 after any success). */
  readonly failures: number
  /** True for the very first re-read after the session started. */
  readonly first: boolean
  /** A number in [0, 1). */
  readonly random: () => number
}

/**
 * How long to wait before the next feed re-read. Many participants start together (an
 * exercise opens, everyone signs in), so the schedule is deliberately NOT lockstep:
 *
 *  - the FIRST re-read lands at a random point between {@link NOTIFICATION_POLL_FIRST_MIN} of
 *    the interval and the full interval after start (the baseline read itself is immediate --
 *    the page needs it);
 *  - every later one is the interval spread +/- {@link NOTIFICATION_POLL_JITTER};
 *  - after repeated failures the delay doubles per consecutive failure (the first failure
 *    retries at the normal pace), up to {@link NOTIFICATION_BACKOFF_CAP_MS} -- a struggling
 *    server is not hammered by every open tab -- and never exceeds that cap, jitter included.
 */
export function nextPollDelayMs({ intervalMs, failures, first, random }: PollDelayInput): number {
  if (first && failures === 0) {
    return Math.round(
      intervalMs * (NOTIFICATION_POLL_FIRST_MIN + (1 - NOTIFICATION_POLL_FIRST_MIN) * random()),
    )
  }
  const doubled = intervalMs * 2 ** Math.max(0, failures - 1)
  const backedOff = Math.min(NOTIFICATION_BACKOFF_CAP_MS, doubled)
  const spread = 1 + (random() * 2 - 1) * NOTIFICATION_POLL_JITTER
  return Math.round(Math.min(NOTIFICATION_BACKOFF_CAP_MS, backedOff * spread))
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultDeps(): NotificationsDeps {
  return {
    fetchFeed: () => resolveFeed('all', { includeReplies: true }),
    source: () => defaultArrivalSource,
    engagement: () => defaultEngagementChangeSource,
    removed: removedPosts,
    storage: getPersistentStorage,
    sweepStorages: () => [getPersistentStorage(), getSessionStorage()],
    random: Math.random,
    now: () => scenarioNow().toISOString(),
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    onVisibilityChange: listener => {
      if (typeof document === 'undefined') return () => undefined
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
    pollIntervalMs: NOTIFICATION_POLL_INTERVAL_MS,
    readJitterMs: NOTIFICATION_READ_JITTER_MS,
    onStorageChange: listener => {
      if (typeof window === 'undefined') return () => undefined
      const handler = (event: StorageEvent) =>
        listener({ key: event.key, newValue: event.newValue, storageArea: event.storageArea })
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    },
    publishDelayMs: NOTIFICATION_PUBLISH_DELAY_MS,
    announceThrottleMs: NOTIFICATION_ANNOUNCE_THROTTLE_MS,
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Everything one running session owns. */
interface ActiveSession {
  readonly storageKey: string
  readonly model: NotificationModel
  readonly source: FeedStreamSource
  stopped: boolean
  status: NotificationsStatus
  /** The baseline read has landed. */
  loaded: boolean
  inFlight: boolean
  /** Arrivals held until the baseline lands. */
  buffer: ParticipantPostView[]
  /** Engagement frames held until the baseline lands: the newest per post (DF-19). */
  readonly pendingFrames: Map<string, PostEngagementChangedEvent>
  /**
   * A read was skipped because the tab was hidden or the shell overlay was up -- a poll tick, or
   * the baseline of a session that started held. Made up by {@link catchUpRead} when things clear.
   */
  missedWhileHidden: boolean
  /** The shell's pause / EndEx overlay is up: the feed reads (baseline and periodic) hold. */
  paused: boolean
  /** The jittered baseline read has not started yet. */
  baselineTimer: ReturnType<typeof setTimeout> | undefined
  unsubscribeStorage: (() => void) | undefined
  /** Removed ids already applied to the model. */
  readonly appliedRemoved: Set<string>
  publishTimer: ReturnType<typeof setTimeout> | undefined
  pollTimer: ReturnType<typeof setTimeout> | undefined
  /** Consecutive failed reads (drives the backoff). */
  failures: number
  /** The first re-read has been scheduled. */
  scheduledFirst: boolean
  unsubscribeArrivals: (() => void) | undefined
  unsubscribeEngagement: (() => void) | undefined
  unsubscribeRemoved: (() => void) | undefined
  unsubscribeVisibility: (() => void) | undefined
  sourceStarted: boolean
}

export function createNotificationsStore(
  overrides: Partial<NotificationsDeps> = {},
): NotificationsStore {
  const resolveDeps = (): NotificationsDeps => ({ ...defaultDeps(), ...overrides })

  const listeners = new Set<() => void>()
  let session: ActiveSession | undefined
  /**
   * This tab has run a notifications session since its last sweep: only then does sign-out have
   * anything of its own to wipe. `start` arms it, `reset` spends it (see "SIGN-OUT" above).
   */
  let ownsState = false
  /**
   * The shell's pause / EndEx overlay is up. Kept here, not only on the session, because the
   * engine's `OverlayHold` reports it BEFORE the engine starts the session (see the module
   * header); every session is created with this value.
   */
  let overlayHeld = false
  let snapshot: NotificationsSnapshot = INACTIVE_SNAPSHOT
  let summary: NotificationsSummary = UNAVAILABLE_SUMMARY
  let announcement: NotificationsAnnouncement = NO_ANNOUNCEMENT

  // Announcement throttle state (shared across sessions' lifetime only while one runs).
  let held = emptyHeld()
  let cooling = false
  let coolTimer: ReturnType<typeof setTimeout> | undefined

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  // ---- announcements ------------------------------------------------------

  function speak(text: string): void {
    announcement = { seq: announcement.seq + 1, text }
    notify()
  }

  function flushHeld(): void {
    if (held.events === 0) return
    const text = describeAnnouncement(held)
    held = emptyHeld()
    speak(text)
  }

  function startCooldown(throttleMs: number): void {
    cooling = true
    coolTimer = setTimeout(() => {
      cooling = false
      coolTimer = undefined
      if (held.events > 0) {
        flushHeld()
        startCooldown(throttleMs)
      }
    }, throttleMs)
  }

  function announce(event: NotificationEvent, throttleMs: number): void {
    held.events += 1
    held.amountByType[event.type] += event.amount
    if (cooling) return // held; spoken when the cooldown ends
    flushHeld()
    startCooldown(throttleMs)
  }

  function clearAnnouncements(): void {
    if (coolTimer !== undefined) clearTimeout(coolTimer)
    coolTimer = undefined
    cooling = false
    held = emptyHeld()
  }

  // ---- publishing ---------------------------------------------------------

  function persistIfDirty(s: ActiveSession, storage: Storage | undefined): void {
    if (!s.model.takeDirty()) return
    // Merged with what is stored: another tab of this viewer may have written since we loaded.
    const merged = mergeForWrite(readPersisted(storage, s.storageKey), s.model.toPersisted())
    writePersisted(storage, s.storageKey, merged)
  }

  function publishNow(s: ActiveSession, deps: NotificationsDeps): void {
    if (s.stopped || session !== s) return
    if (s.publishTimer !== undefined) {
      clearTimeout(s.publishTimer)
      s.publishTimer = undefined
    }
    const all = s.model.items()
    let unread = 0
    for (const item of all) if (item.unread) unread += 1
    snapshot = {
      status: s.status,
      items: all.length > MAX_NOTIFICATION_ROWS ? all.slice(0, MAX_NOTIFICATION_ROWS) : all,
      hiddenCount: Math.max(0, all.length - MAX_NOTIFICATION_ROWS),
      unread,
    }
    if (!summary.available || summary.unread !== unread) summary = { available: true, unread }
    persistIfDirty(s, deps.storage())
    notify()
  }

  function schedulePublish(s: ActiveSession, deps: NotificationsDeps): void {
    if (s.stopped || s.publishTimer !== undefined) return
    s.publishTimer = setTimeout(() => {
      s.publishTimer = undefined
      publishNow(s, deps)
    }, deps.publishDelayMs)
  }

  // ---- data flow ----------------------------------------------------------

  function onArrival(s: ActiveSession, deps: NotificationsDeps, post: ParticipantPostView): void {
    if (s.stopped) return
    if (!s.loaded) {
      // Not classifiable until my own posts are known: hold it (bounded) for the replay.
      if (s.buffer.length >= PRELOAD_BUFFER_CAP) s.buffer.shift()
      s.buffer.push(post)
      return
    }
    const result = s.model.ingest(post)
    if (result.event !== undefined) announce(result.event, deps.announceThrottleMs)
    if (result.changed) schedulePublish(s, deps)
  }

  /**
   * One `PostEngagementChanged` frame (DF-19). Before the baseline it is held (the newest frame per
   * post; the model drops anything older anyway) and replayed after the read; afterwards it goes
   * straight to the model, which ignores frames for posts that are not mine and stale versions.
   */
  function onEngagement(
    s: ActiveSession,
    deps: NotificationsDeps,
    frame: PostEngagementChangedEvent,
  ): void {
    if (s.stopped) return
    if (!s.loaded) {
      const held = s.pendingFrames.get(frame.postId)
      if (held === undefined || frame.version > held.version) {
        s.pendingFrames.delete(frame.postId) // re-insert at the newest end
        s.pendingFrames.set(frame.postId, frame)
        if (s.pendingFrames.size > PRELOAD_BUFFER_CAP) {
          const oldest = s.pendingFrames.keys().next()
          if (oldest.done !== true) s.pendingFrames.delete(oldest.value)
        }
      }
      return
    }
    const result = s.model.observeEngagement(frame.postId, frame.counts, frame.version)
    for (const event of result.events) announce(event, deps.announceThrottleMs)
    if (result.changed) schedulePublish(s, deps)
  }

  /**
   * One feed read. Resolves to what happened -- `ok`, `failed` (drives the backoff) or `skipped`
   * (stopped, or a read is already in flight: nothing was asked, so nothing is counted).
   */
  async function loadFeed(
    s: ActiveSession,
    deps: NotificationsDeps,
  ): Promise<'ok' | 'failed' | 'skipped'> {
    if (s.stopped || s.inFlight) return 'skipped'
    s.inFlight = true
    let posts: readonly Post[]
    try {
      posts = await deps.fetchFeed()
    } catch {
      // A failed read leaves what we have; before the first success it is the page's
      // "not available" state. The next tick retries (later, if it keeps failing).
      if (!s.stopped) {
        s.failures += 1
        if (!s.loaded) {
          s.status = 'error'
          publishNow(s, deps)
        }
      }
      return 'failed'
    } finally {
      s.inFlight = false
    }
    if (s.stopped) return 'skipped'
    s.failures = 0

    // XC-002: narrow through the one sanctioned path before the model sees a post.
    const events = s.model.ingestBatch(posts.map(toParticipantView))
    if (s.loaded) {
      // A re-read: whatever is new since the last one is worth saying.
      for (const event of events) announce(event, deps.announceThrottleMs)
    } else {
      // The baseline: what is already there is shown (badge, rows) but NOT announced.
      s.loaded = true
      s.status = 'ready'
      const replay = s.buffer
      s.buffer = []
      for (const post of replay) {
        const result = s.model.ingest(post)
        if (result.event !== undefined) announce(result.event, deps.announceThrottleMs)
      }
      // Frames that beat the baseline (DF-19): one already in the read moves nothing.
      const frames = [...s.pendingFrames.values()]
      s.pendingFrames.clear()
      for (const frame of frames) {
        const result = s.model.observeEngagement(frame.postId, frame.counts, frame.version)
        for (const event of result.events) announce(event, deps.announceThrottleMs)
      }
    }
    applyRemoved(s, deps)
    publishNow(s, deps)
    return 'ok'
  }

  /**
   * Schedules the next re-read (see {@link nextPollDelayMs}). A chain of timeouts rather than
   * an interval: the next one is set only after the previous has finished, so a slow server
   * can never be handed overlapping reads, and the delay can change with the failure count.
   * While the tab is hidden a tick reads nothing (it only notes that one was missed) and the
   * chain carries on.
   */
  function scheduleNextRead(s: ActiveSession, deps: NotificationsDeps): void {
    if (s.stopped) return
    const delay = nextPollDelayMs({
      intervalMs: deps.pollIntervalMs,
      failures: s.failures,
      first: !s.scheduledFirst,
      random: deps.random,
    })
    s.scheduledFirst = true
    s.pollTimer = setTimeout(() => runTick(s, deps), delay)
  }

  /**
   * One scheduled tick: read if the tab is visible and the shell is not paused; otherwise only
   * note that a read was missed (made up by {@link catchUpRead} when things clear). Either way
   * the chain carries on.
   */
  function runTick(s: ActiveSession, deps: NotificationsDeps): void {
    s.pollTimer = undefined
    if (s.stopped) return
    if (!deps.isVisible() || s.paused) {
      s.missedWhileHidden = true
      scheduleNextRead(s, deps)
      return
    }
    // (`loadFeed` handles its own failures; the catch only keeps the chain alive.)
    void loadFeed(s, deps)
      .catch(() => undefined)
      .then(() => scheduleNextRead(s, deps))
  }

  /**
   * The session's first read. Held like any other while the shell overlay is up -- the session
   * then waits at `loading` behind the holding page and the read is made up, jittered, when the
   * overlay clears (see {@link catchUpRead}); a hold that lands inside the jittered start-up wait
   * is honoured too.
   */
  function runBaseline(s: ActiveSession, deps: NotificationsDeps): void {
    if (s.stopped) return
    if (s.paused) {
      s.missedWhileHidden = true
      return
    }
    void loadFeed(s, deps)
  }

  /** A random delay in [0, readJitterMs): spreads reads many tabs would start together. */
  function readJitter(deps: NotificationsDeps): number {
    return Math.round(deps.random() * deps.readJitterMs)
  }

  /**
   * Makes up a read that was missed while the tab was hidden or the shell was paused: after a
   * short random delay (a whole room coming back from a pause must not read in the same
   * instant), and the schedule is RE-SET behind it, so the next tick is a normal interval after
   * this read rather than whatever was left on the old timer.
   */
  function catchUpRead(s: ActiveSession, deps: NotificationsDeps): void {
    s.missedWhileHidden = false
    if (s.pollTimer !== undefined) clearTimeout(s.pollTimer)
    s.pollTimer = setTimeout(() => runTick(s, deps), readJitter(deps))
  }

  /** Applies removed ids not yet applied; returns whether anything visible changed. */
  function applyRemoved(s: ActiveSession, deps: NotificationsDeps): boolean {
    let changed = false
    for (const id of deps.removed.getAll()) {
      if (s.appliedRemoved.has(id)) continue
      s.appliedRemoved.add(id)
      if (s.model.remove(id)) changed = true
    }
    return changed
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Releases every subscription/timer a session holds. Does not write or publish. */
  function teardown(s: ActiveSession): void {
    s.stopped = true
    if (s.publishTimer !== undefined) clearTimeout(s.publishTimer)
    if (s.pollTimer !== undefined) clearTimeout(s.pollTimer)
    if (s.baselineTimer !== undefined) clearTimeout(s.baselineTimer)
    s.publishTimer = undefined
    s.pollTimer = undefined
    s.baselineTimer = undefined
    s.unsubscribeArrivals?.()
    s.unsubscribeEngagement?.()
    s.unsubscribeRemoved?.()
    s.unsubscribeVisibility?.()
    s.unsubscribeStorage?.()
    s.unsubscribeArrivals = undefined
    s.unsubscribeEngagement = undefined
    s.unsubscribeRemoved = undefined
    s.unsubscribeVisibility = undefined
    s.unsubscribeStorage = undefined
    if (s.sourceStarted) {
      s.sourceStarted = false
      s.source.stop()
    }
    s.buffer = []
    s.pendingFrames.clear()
    clearAnnouncements()
  }

  function setInactive(): void {
    snapshot = INACTIVE_SNAPSHOT
    summary = UNAVAILABLE_SUMMARY
    announcement = NO_ANNOUNCEMENT
    notify()
  }

  function stopSession(s: ActiveSession, deps: NotificationsDeps, persist: boolean): void {
    if (persist) persistIfDirty(s, deps.storage())
    teardown(s)
    if (session === s) {
      session = undefined
      setInactive()
    }
  }

  function start(config: NotificationsSessionConfig): () => void {
    const deps = resolveDeps()
    if (session !== undefined) stopSession(session, deps, true) // one session at a time

    ownsState = true // (armed again by every start; spent by the next sweep)
    const storageKey = notificationStorageKey(config.exerciseId, config.personaId, config.accountId)
    // One browser holds one participant session, so any entry that is not THIS viewer's is dead
    // weight (a previous sign-in's, another persona's, an expired exercise's): sweep it. The
    // state store keeps the current key; any other store (a leftover per-tab entry) keeps nothing.
    for (const storage of new Set([deps.storage(), ...deps.sweepStorages()])) {
      clearAllNotificationStorage(storage, storage === deps.storage() ? storageKey : undefined)
    }
    const model = new NotificationModel({
      selfPersonaId: config.personaId,
      selfHandle: config.handle,
      persisted: readPersisted(deps.storage(), storageKey),
      now: deps.now,
      isRemoved: postId => deps.removed.has(postId),
    })
    const s: ActiveSession = {
      storageKey,
      model,
      source: deps.source(),
      stopped: false,
      status: 'loading',
      loaded: false,
      inFlight: false,
      buffer: [],
      pendingFrames: new Map(),
      missedWhileHidden: false,
      paused: overlayHeld,
      baselineTimer: undefined,
      unsubscribeStorage: undefined,
      appliedRemoved: new Set(),
      publishTimer: undefined,
      pollTimer: undefined,
      failures: 0,
      scheduledFirst: false,
      unsubscribeArrivals: undefined,
      unsubscribeEngagement: undefined,
      unsubscribeRemoved: undefined,
      unsubscribeVisibility: undefined,
      sourceStarted: false,
    }
    session = s
    held = emptyHeld()
    announcement = NO_ANNOUNCEMENT
    summary = { available: true, unread: 0 }
    snapshot = { status: 'loading', items: [], hiddenCount: 0, unread: 0 }

    // Realtime: replies and mentions arrive through the shared arrival source.
    s.unsubscribeArrivals = s.source.subscribe(post => onArrival(s, deps, post))
    s.sourceStarted = true
    // Fail-soft: a source that cannot start yields no stream; the 30 s read still runs.
    void s.source.start().catch(() => undefined)

    // DF-19: likes and reposts on my posts arrive live as engagement frames. The frames ride the
    // same shared connection the arrival source just started; nothing new is opened.
    s.unsubscribeEngagement = deps.engagement().subscribeEngagementChanged(frame =>
      onEngagement(s, deps, frame))

    s.unsubscribeRemoved = deps.removed.subscribe(() => {
      // A takedown drops the row at once (no waiting for the coalescing window).
      if (applyRemoved(s, deps) && s.loaded) publishNow(s, deps)
    })

    // The baseline read (after a short random delay, so a room that opened together does not
    // read in the same instant), then a re-read about every 30 s while the tab is visible. A
    // session that starts while the shell overlay is up holds it (`runBaseline`).
    const baselineDelay = readJitter(deps)
    if (baselineDelay <= 0) {
      runBaseline(s, deps)
    } else {
      s.baselineTimer = setTimeout(() => {
        s.baselineTimer = undefined
        runBaseline(s, deps)
      }, baselineDelay)
    }
    scheduleNextRead(s, deps)
    s.unsubscribeVisibility = deps.onVisibilityChange(() => {
      if (s.missedWhileHidden && deps.isVisible() && !s.paused) catchUpRead(s, deps)
    })

    // Another tab removed (or cleared) THIS viewer's entry -- a sign-out, or another sign-in's
    // sweep. This tab's state is stale: end the session without writing it back.
    s.unsubscribeStorage = deps.onStorageChange(change => {
      if (change.storageArea !== null && change.storageArea !== deps.storage()) return
      const gone = change.key === null || (change.key === s.storageKey && change.newValue === null)
      if (!gone || session !== s) return
      teardown(s) // no persist
      session = undefined
      setInactive()
    })

    notify()
    return () => {
      // Idempotent, and a no-op once a newer session (or a reset) has replaced this one.
      if (session === s) stopSession(s, deps, true)
    }
  }

  function markAllRead(): void {
    const s = session
    if (s === undefined || s.stopped) return
    const deps = resolveDeps()
    s.model.markAllRead()
    publishNow(s, deps)
    // Anything still HELD ("14 new replies") is now moot -- it would be spoken after "all read".
    clearAnnouncements()
    speak('All notifications marked as read')
  }

  function setPaused(paused: boolean): void {
    overlayHeld = paused // remembered even with no session: the next `start` begins with it
    const s = session
    if (s === undefined || s.stopped || s.paused === paused) return
    s.paused = paused
    // Resumed with a read missed while paused: make it up (jittered), as for a hidden tab.
    if (!paused && s.missedWhileHidden && resolveDeps().isVisible()) {
      catchUpRead(s, resolveDeps())
    }
  }

  function reset(): void {
    // A tab that has not run a notifications session since its last sweep (a STAFF tab, a
    // read-only participant, a tab that already signed its participant out) has nothing of its
    // own to forget -- and its sign-out must not wipe the state of a participant signed in
    // elsewhere in the same browser.
    if (!ownsState) return
    const deps = resolveDeps()
    const s = session
    if (s !== undefined) {
      teardown(s) // no persist: a sign-out must leave nothing behind
      session = undefined
    }
    // Sign-out sweeps EVERY store the state could be in (see `notificationStorage`).
    for (const storage of new Set([deps.storage(), ...deps.sweepStorages()])) {
      clearAllNotificationStorage(storage)
    }
    // The sweep spends the ownership: this tab now holds nothing of its own, so a later reset
    // (the next sign-in's, a staff sign-out) must not reach into another tab's participant state.
    // Only a newly started session re-arms it.
    ownsState = false
    setInactive()
  }

  return {
    start,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    getSummary: () => summary,
    getAnnouncement: () => announcement,
    markAllRead,
    setPaused,
    reset,
  }
}

/** The app-wide notifications store. Idle until `NotificationsEngine` starts a session. */
export const notificationsStore: NotificationsStore = createNotificationsStore()

// Sign-out forgets the session's notification state (read ids, like baselines) and sweeps the
// tab's storage: the store is a module singleton that lives as long as the TAB, and
// `core/auth` cannot import this feature, so it registers here -- the way the controller
// composer registers its drafts. The unregister is tied to Vite's hot replacement of THIS
// module so a dev session does not pile up one stale reset per edit.
registerSessionReset(() => notificationsStore.reset(), import.meta.hot)
