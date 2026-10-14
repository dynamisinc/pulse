/**
 * features/social/services/realtimeFeed.ts
 * ---------------------------------------------------------------------------
 * The social feed's consumer of the shared real-time transport (feature:
 * social-api, story 03; SOC-083, NFR-003, XC-002, COR-053). It turns the
 * hub's `PostReceived` pushes into a stream of participant-safe posts, and —
 * when the hub is unreachable or a drop outlasts the reconnect window — falls
 * back to POLLING `resolveFeed()` (`GET /feed`) so "real time" is never
 * silently, permanently lost (NFR-003). It recovers to push transport
 * automatically once the hub returns.
 *
 * This ships the TRANSPORT only. The buffered "▲ N new posts" pill UX,
 * scroll-preservation and hover-to-pause are `feeds-discovery/04`'s
 * `useFeedStream()` (the documented first consumer) — NOT built here. This
 * module surfaces individual, deduped, participant-safe posts; the pill layers
 * on top later.
 *
 * XC-002. Every surfaced post is a participant-safe `ParticipantPostView`.
 * Pushed payloads are validated and rebuilt field-by-field (never spread), and
 * polled `Post`s are narrowed through the sole sanctioned `toParticipantView`
 * — so `origin`/`actingHumanId`/`createdWallClock`/`injectId` can never reach a
 * caller.
 *
 * CONTRACT v2 (demo-polish F2). A `PostReceived` payload is the full
 * `ParticipantPostView` minus `viewer`, so the rebuild also KEEPS the two v2
 * members a live post needs to render: `media` (photos / the inline video) and
 * `inReplyTo` ("Replying to @handle"). Both are rebuilt key-by-key like every
 * other field: a malformed `media` ENTRY (no id/kind/url/alt, a wrong-typed
 * size, an unknown kind) is DROPPED and the rest of the post is still delivered —
 * a bad attachment never crashes the stream or hides the post — and a malformed
 * `inReplyTo` is omitted. Nothing is spread, so a stray provenance key riding
 * inside a media entry or the reply object is dropped too (XC-002). `viewer` is
 * never copied (it is absent on broadcasts by contract). Whether a media `url` is
 * safe to RENDER is not decided here — the media components allow-list it
 * (`components/media/safeMediaUrl.ts`).
 *
 * CONTRACT v2 (demo-polish C5): `PostRemoved`. The same hub also pushes `PostRemoved
 * { postId }` when a controller takes a post down (B6, implementation.md §1.5.5). It is
 * validated the same way — the payload is rebuilt as `{ postId }` ONLY (a non-object, a
 * missing / non-string / empty id, or a stray provenance key riding along never reaches a
 * subscriber) — and surfaced through `subscribeRemoved`. This module decides nothing about
 * WHAT to do with a removal and cannot know which ids any surface is showing, so it
 * surfaces every well-formed id; a consumer that is not showing the post ignores it. The
 * app-wide singleton is wired (bottom of the file) to record each id in the session's
 * `removedPosts` store, which is what `<Feed>` and the Explore baseline react to. A removal
 * is a push-only fact: while the transport is POLLING there is no `PostRemoved`, and the
 * post simply stops being returned by the next read (the server omits it).
 *
 * TESTABILITY (NFR-003 fallback + recovery). `createRealtimeFeed({ connection,
 * fetchFeed, pollIntervalMs, reconnectWindowMs })` lets RTL inject a fake
 * connection (to force "hub unreachable → polling" and "recover") and a fake
 * feed source, with short timings, using fake timers. The app uses the shared
 * `realtimeFeed` singleton bound to the shared `realtimeConnection`.
 *
 * World: participant (Pulse Social skin) — pure service module, no UI, no
 * COBRA, no wall-clock (COR-053; scenario time rides on each post untouched).
 */

import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'
import { parseMediaAssetView } from '@/core/media/mediaGuards'
import { toParticipantView } from '@/features/social'
import type { ParticipantPostView, Post, PostInReplyTo, PostMedia } from '@/features/social'
import { resolveFeed } from './feedService'
import { removedPosts } from './removedPosts'

/** The hub event carrying a newly-persisted post. Mirrors `SignalRFeedBroadcaster`'s constant. */
const POST_RECEIVED_EVENT = 'PostReceived'

/** The hub event carrying a taken-down post's id (B6). Mirrors the broadcaster's constant. */
const POST_REMOVED_EVENT = 'PostRemoved'

/** Default polling cadence while degraded (NFR-003 fallback). */
const DEFAULT_POLL_INTERVAL_MS = 5000

/** Default bounded window a reconnect episode may run before we degrade to polling (NFR-003). */
const DEFAULT_RECONNECT_WINDOW_MS = 15000

/** Which transport is currently delivering posts. */
export type FeedTransportMode = 'connecting' | 'realtime' | 'polling'

/** A subscriber that receives each newly-observed participant-safe post. */
export type PostStreamHandler = (post: ParticipantPostView) => void

/** A taken-down post, as surfaced to subscribers: the id and NOTHING else (B6's whole payload). */
export interface PostRemovedEvent {
  readonly postId: string
}

/** A subscriber that receives each validated `PostRemoved`. */
export type PostRemovedHandler = (event: PostRemovedEvent) => void

/** The social feed's real-time consumer surface. */
export interface RealtimeFeed {
  /** Registers a handler for each newly-observed post. Returns an idempotent unsubscribe. */
  subscribe(handler: PostStreamHandler): () => void
  /**
   * Registers a handler for each validated `PostRemoved { postId }` push (a controller
   * took the post down). Returns an idempotent unsubscribe. Push-only: nothing is
   * delivered while the transport is polling (see the module header).
   */
  subscribeRemoved(handler: PostRemovedHandler): () => void
  /**
   * Starts the transport (attempts real-time, degrades to polling on failure).
   * Resolves once running.
   */
  start(): Promise<void>
  /** Stops the transport and releases all timers/subscriptions. */
  stop(): void
  /** The active transport mode. */
  readonly mode: FeedTransportMode
}

/** Options for {@link createRealtimeFeed} — overrides used by tests. */
export interface CreateRealtimeFeedOptions {
  /** The shared connection to consume (defaults to the app-wide `realtimeConnection`). */
  readonly connection?: RealtimeConnection
  /** The polling-fallback data source (defaults to `resolveFeed`/`GET /feed`). */
  readonly fetchFeed?: () => Promise<Post[]>
  /** Polling cadence, ms (default {@link DEFAULT_POLL_INTERVAL_MS}). */
  readonly pollIntervalMs?: number
  /** Reconnect window before degrading to polling, ms (default 15000). */
  readonly reconnectWindowMs?: number
}

/** One `media` entry rebuilt from its contract keys, or `null` when it is malformed. */
function toPostMedia(entry: unknown): PostMedia | null {
  // The asset keys (id, kind, url, posterUrl, width, height, durationSec) are parsed and
  // REBUILT by the shared guard: null on an optional member is absent, a wrong type fails.
  const asset = parseMediaAssetView(entry)
  if (asset === undefined) return null
  // `alt` is REQUIRED on every attachment (NFR-001) — an entry without one is malformed.
  const { alt } = entry as Record<string, unknown>
  if (typeof alt !== 'string' || alt.trim().length === 0) return null
  return { ...asset, alt }
}

/**
 * The valid entries of a payload's `media`, or `undefined` when there are none.
 * A non-array `media`, or one whose every entry is malformed, yields `undefined`
 * (the key is omitted); a partly-malformed array keeps just the good entries.
 */
function toPostMediaList(value: unknown): PostMedia[] | undefined {
  if (!Array.isArray(value)) return undefined
  const media: PostMedia[] = []
  for (const entry of value) {
    const item = toPostMedia(entry)
    if (item !== null) media.push(item)
  }
  return media.length > 0 ? media : undefined
}

/** A payload's `inReplyTo` rebuilt from its two contract keys, or `undefined` when malformed. */
function toInReplyTo(value: unknown): PostInReplyTo | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { postId, authorHandle } = value as Record<string, unknown>
  if (typeof postId !== 'string' || postId.length === 0) return undefined
  if (typeof authorHandle !== 'string' || authorHandle.length === 0) return undefined
  return { postId, authorHandle }
}

/**
 * Validates a raw `PostReceived` payload and rebuilds it as a participant-safe
 * `ParticipantPostView`. Returns `null` (dropped, never cast blindly) for any
 * out-of-shape payload. Builds a fresh literal from the known-safe fields only
 * — it never spreads the payload, so no stray provenance key can ride along
 * (XC-002 defence in depth; the server already omits them). The contract-v2
 * members `media` and `inReplyTo` are kept when well-formed (see the module header).
 */
function toParticipantPostView(payload: unknown): ParticipantPostView | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { id, authorPersonaId, text, scenarioTime, counts, media, inReplyTo } =
    payload as Record<string, unknown>
  if (
    typeof id !== 'string' || id.length === 0 ||
    typeof authorPersonaId !== 'string' || authorPersonaId.length === 0 ||
    typeof text !== 'string' ||
    typeof scenarioTime !== 'string' || scenarioTime.length === 0 ||
    typeof counts !== 'object' || counts === null
  ) {
    return null
  }
  const { reply, repost, like } = counts as Record<string, unknown>
  if (typeof reply !== 'number' || typeof repost !== 'number' || typeof like !== 'number') {
    return null
  }

  const mediaList = toPostMediaList(media)
  const replyTo = toInReplyTo(inReplyTo)
  return {
    id,
    authorPersonaId,
    text,
    scenarioTime,
    counts: { reply, repost, like },
    ...(mediaList !== undefined ? { media: mediaList } : {}),
    ...(replyTo !== undefined ? { inReplyTo: replyTo } : {}),
  }
}

/**
 * Validates a raw `PostRemoved` payload and rebuilds it as `{ postId }`. Returns `null`
 * (dropped, never cast blindly) for anything but an object with a non-empty string
 * `postId`. A fresh literal from the one known key — never a spread — so nothing else the
 * wire carried can ride along (XC-002 defence in depth). The id is opaque: it is NOT
 * required to be a GUID (the mock backend's ids are not).
 */
function toPostRemovedEvent(payload: unknown): PostRemovedEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { postId } = payload as Record<string, unknown>
  if (typeof postId !== 'string' || postId.length === 0) return null
  return { postId }
}

/**
 * Drives the feed transport: real-time by default, polling fallback while
 * degraded, automatic recovery. See the module header for the guarantees.
 */
class RealtimeFeedController implements RealtimeFeed {
  private readonly connection: RealtimeConnection
  private readonly fetchFeed: () => Promise<Post[]>
  private readonly pollIntervalMs: number
  private readonly reconnectWindowMs: number
  private readonly handlers = new Set<PostStreamHandler>()
  private readonly removedHandlers = new Set<PostRemovedHandler>()
  private readonly seenIds = new Set<string>()
  private currentMode: FeedTransportMode = 'connecting'
  private baselined = false
  private started = false
  private pollInFlight = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private reconnectWindowTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribePush: (() => void) | null = null
  private unsubscribeRemoved: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null

  constructor(options: CreateRealtimeFeedOptions = {}) {
    this.connection = options.connection ?? realtimeConnection
    this.fetchFeed = options.fetchFeed ?? resolveFeed
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.reconnectWindowMs = options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW_MS
  }

  get mode(): FeedTransportMode {
    return this.currentMode
  }

  subscribe(handler: PostStreamHandler): () => void {
    this.handlers.add(handler)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.handlers.delete(handler)
    }
  }

  subscribeRemoved(handler: PostRemovedHandler): () => void {
    this.removedHandlers.add(handler)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.removedHandlers.delete(handler)
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.currentMode = 'connecting'

    this.unsubscribePush = this.connection.subscribe(POST_RECEIVED_EVENT, payload => {
      this.handlePush(payload)
    })
    this.unsubscribeRemoved = this.connection.subscribe(POST_REMOVED_EVENT, payload => {
      this.handleRemovedPush(payload)
    })
    this.unsubscribeState = this.connection.onStateChange(state => {
      this.handleStateChange(state)
    })

    try {
      await this.connection.start()
      this.enterRealtime()
    } catch {
      // Hub unreachable on first connect (NFR-003) — degrade to polling immediately.
      this.enterPolling()
    }
  }

  stop(): void {
    this.started = false
    this.clearReconnectWindow()
    this.stopPolling()
    if (this.unsubscribePush !== null) {
      this.unsubscribePush()
      this.unsubscribePush = null
    }
    if (this.unsubscribeRemoved !== null) {
      this.unsubscribeRemoved()
      this.unsubscribeRemoved = null
    }
    if (this.unsubscribeState !== null) {
      this.unsubscribeState()
      this.unsubscribeState = null
    }
  }

  private handleStateChange(state: HubConnectionState): void {
    if (!this.started) return
    switch (state) {
      case HubConnectionState.Connected:
        this.enterRealtime()
        break
      case HubConnectionState.Reconnecting:
        this.armReconnectWindow()
        break
      case HubConnectionState.Disconnected:
        this.enterPolling()
        break
      default:
        break
    }
  }

  private enterRealtime(): void {
    this.clearReconnectWindow()
    this.stopPolling()
    this.currentMode = 'realtime'
  }

  private enterPolling(): void {
    this.clearReconnectWindow()
    this.currentMode = 'polling'
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(() => {
      void this.pollTick()
    }, this.pollIntervalMs)
    // Kick an immediate tick so the fallback (and the recovery driver) start
    // without waiting a full interval.
    void this.pollTick()
  }

  private armReconnectWindow(): void {
    if (this.reconnectWindowTimer !== null) return
    this.reconnectWindowTimer = setTimeout(() => {
      this.reconnectWindowTimer = null
      // The reconnect episode outlasted the bounded window — degrade to polling until it recovers.
      if (this.connection.state !== HubConnectionState.Connected) {
        this.enterPolling()
      }
    }, this.reconnectWindowMs)
  }

  private clearReconnectWindow(): void {
    if (this.reconnectWindowTimer !== null) {
      clearTimeout(this.reconnectWindowTimer)
      this.reconnectWindowTimer = null
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollTick(): Promise<void> {
    // In-flight guard: setInterval fires on a fixed cadence and does not await the
    // async tick, so a fetchFeed() slower than pollIntervalMs would otherwise let ticks
    // overlap — two concurrent polls could both observe baselined === false and race the
    // dedup/baseline state. Skip a tick while one is still running; the next cadence retries.
    if (this.pollInFlight) return
    this.pollInFlight = true
    try {
      // Recovery driver: while degraded, keep trying to re-establish real-time. A
      // successful start() emits Connected via onStateChange → we return to push transport.
      if (this.connection.state === HubConnectionState.Disconnected) {
        void this.connection.start().catch(() => {
          // Still unreachable — remain in polling; the next tick retries.
        })
      }

      try {
        const posts = await this.fetchFeed()
        this.handlePoll(posts)
      } catch {
        // Feed fetch failed while degraded — remain in polling; the next tick retries.
      }
    } finally {
      this.pollInFlight = false
    }
  }

  private handlePush(payload: unknown): void {
    const view = toParticipantPostView(payload)
    if (view === null) return
    this.deliverNew(view)
  }

  private handleRemovedPush(payload: unknown): void {
    const event = toPostRemovedEvent(payload)
    if (event === null) return
    // A handler that throws must not starve the others (or the transport's own callback).
    for (const handler of [...this.removedHandlers]) {
      try {
        handler(event)
      } catch {
        // Isolated: one consumer's failure is not the removal's failure.
      }
    }
  }

  private handlePoll(posts: readonly Post[]): void {
    if (!this.baselined) {
      // First observation after degrading: adopt the current feed as the baseline
      // WITHOUT emitting — those posts are already rendered; the stream carries
      // only what arrives afterwards (this is transport dedup, not the 04 pill).
      for (const post of posts) this.seenIds.add(post.id)
      this.baselined = true
      return
    }
    for (const post of posts) this.deliverNew(toParticipantView(post))
  }

  private deliverNew(view: ParticipantPostView): void {
    if (this.seenIds.has(view.id)) return
    this.seenIds.add(view.id)
    for (const handler of this.handlers) handler(view)
  }
}

/**
 * Creates an isolated feed transport. The app uses {@link realtimeFeed}; tests use
 * this to inject fakes.
 */
export function createRealtimeFeed(options: CreateRealtimeFeedOptions = {}): RealtimeFeed {
  return new RealtimeFeedController(options)
}

/**
 * The app-wide social feed transport, bound to the shared `realtimeConnection`.
 * Lazy: no side effects until started.
 */
export const realtimeFeed: RealtimeFeed = createRealtimeFeed()

// Every valid `PostRemoved` on the app-wide transport is recorded in the session's removed-post
// store (C5) — the one place `<Feed>` and the Explore baseline learn that a post must go. Wired
// here (not inside the controller) so an isolated `createRealtimeFeed()` in a test never writes to
// global state. It only registers a handler; it touches neither the network nor the connection.
realtimeFeed.subscribeRemoved(({ postId }) => removedPosts.add(postId))
