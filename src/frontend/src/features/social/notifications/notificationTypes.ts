/**
 * features/social/notifications/notificationTypes.ts
 * ---------------------------------------------------------------------------
 * The vocabulary of the derived-notifications feature (demo-polish F7, story 16;
 * SOC-070 "lite", SOC-071 aggregation, NFR-001, COR-053): the three notification
 * types, the shape of one row, and the handful of tunables. Participant world --
 * plain types and constants, no UI, no clock, no network.
 *
 * THERE IS NO NOTIFICATION SERVICE. A row is *derived on the client* from the posts the
 * app already loads (the feed with replies, plus the realtime arrivals), so a row can
 * only ever be something real:
 *
 *   reply    someone replied to a post of mine        (`inReplyTo.postId` is one of mine)
 *   mention  someone's post says `@myhandle`          (case-insensitive, on handle edges)
 *   like     one of my posts got new likes            (`counts.like` rose since I looked)
 *
 * AGGREGATION (D1-005 / SOC-071). A row is one *group*, not one event: all the replies to
 * the same post of mine are ONE "Alex and 3 others replied to your post" row, all the
 * likes on one post are ONE "Your post got 5 new likes" row, and the mentions that are
 * replies under the same post are one row. That is what keeps the page legible at the
 * 120-posts/min stress load -- the number of rows is the number of distinct *subject*
 * posts, never the number of arrivals.
 *
 * `NotificationItem` carries ids and data, never names: the page resolves the actors'
 * display names through the channel's shared persona directory at render, so the model
 * needs no cast and an item survives the cast loading late.
 */

/** The three kinds of derived notification. */
export type NotificationType = 'reply' | 'mention' | 'like'

/**
 * One row of the notifications page: a *group* of same-type events about one subject post.
 * Immutable; the model hands back the SAME object for a row that did not change, so a
 * memoized row component skips re-rendering under burst (NFR-002).
 */
export interface NotificationItem {
  /** Stable React key: `${type}:${subjectPostId}`. One row per (type, subject post). */
  readonly id: string
  readonly type: NotificationType
  /**
   * The post this row is ABOUT -- what activating it opens: my post (reply, like), or for
   * a mention the post that mentions me (or, when that is a reply, the post it replies to).
   */
  readonly subjectPostId: string
  /**
   * The subject's author handle when the model knows it (decorates the thread URL only; the
   * thread is resolved by id). `undefined` for a top-level mention: the subject is then the
   * mentioning post itself, whose author is `actorIds[0]`.
   */
  readonly subjectHandle: string | undefined
  /** Scenario-time ISO instant of the newest event in the group (COR-053 -- never wall-clock). */
  readonly at: string
  /** True while any event in the group has not been marked read. */
  readonly unread: boolean
  /** Events in the group: replies, mentions, or (like) how many new likes. */
  readonly count: number
  /** The newest distinct actors (persona ids), newest first, at most {@link ACTOR_PREVIEW_MAX}. */
  readonly actorIds: readonly string[]
  /** How many DISTINCT people are in the group (0 for a like row -- likes are anonymous). */
  readonly actorCount: number
  /** A short plain-text excerpt: the newest reply/mention, or (like) my own post. */
  readonly excerpt: string
}

/**
 * What one ingested post changed -- the engine uses it to decide whether to publish and
 * whether to announce. `amount` is how much to say: 1 per reply/mention, or how many new
 * likes a rise added.
 */
export interface NotificationEvent {
  readonly type: NotificationType
  readonly amount: number
}

/** The result of offering one post to the model. */
export interface IngestResult {
  /** True when the model's visible state changed (a new group member, a like count moved). */
  readonly changed: boolean
  /** Set only for something NEW and UNREAD -- the thing worth announcing. */
  readonly event?: NotificationEvent
}

/** How often the feed is re-read to notice like-count rises (the story fixes it at 30 s). */
export const NOTIFICATION_POLL_INTERVAL_MS = 30_000

/**
 * Publishing is coalesced: a burst of arrivals schedules ONE snapshot after this delay
 * instead of one per arrival, so the rail badge and the page re-render a few times a
 * second at most whatever the arrival rate (SOC-071 / NFR-002).
 */
export const NOTIFICATION_PUBLISH_DELAY_MS = 250

/**
 * The least time between two SPOKEN announcements. The first new item is announced at
 * once; further ones inside the window are held and spoken together when it ends, so a
 * burst reads "14 new replies" once, not fourteen times.
 */
export const NOTIFICATION_ANNOUNCE_THROTTLE_MS = 3_000

/** Rows the page renders (newest first); the rest are summarized by a count, not drawn. */
export const MAX_NOTIFICATION_ROWS = 100

/** The badge shows this many, then `99+`. */
export const BADGE_DISPLAY_CAP = 99

/** Most read-event ids remembered per persona (oldest forgotten first). */
export const READ_IDS_CAP = 500

/** Most per-post like records remembered per persona (oldest forgotten first). */
export const LIKE_RECORDS_CAP = 200

/** Arrivals held while the first feed read is in flight (oldest dropped past this). */
export const PRELOAD_BUFFER_CAP = 500

/** Longest excerpt shown under a row, in characters. */
export const EXCERPT_MAX_LENGTH = 140

/** Most actor avatars/names a row previews. */
export const ACTOR_PREVIEW_MAX = 2
