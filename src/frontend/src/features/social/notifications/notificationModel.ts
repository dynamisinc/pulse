/**
 * features/social/notifications/notificationModel.ts
 * ---------------------------------------------------------------------------
 * The DERIVATION: turns the posts the app already loads into notification rows
 * (demo-polish F7, story 16; SOC-070 lite, SOC-071, COR-053, XC-002). Participant
 * world -- a pure, incremental, framework-free model. No React, no timers, no network,
 * no storage, no wall-clock: the store drives it and persists what it reports.
 *
 * WHAT IS DERIVED (nothing is fabricated -- see `notificationTypes.ts`)
 *   (a) reply    a post whose `inReplyTo.postId` is one of MY posts;
 *   (b) mention  a post whose text contains `@myhandle` (case-insensitive, on handle
 *                boundaries: `@dreyes_fh` and `@DREYES_FH,` match, `@dreyes_fhx` and
 *                `me@dreyes_fh.org` do not);
 *   (c) like     one aggregated row per post of mine whose `counts.like` rose since the
 *                viewer last looked ("Your post got 3 new likes");
 *   (d) repost   the same, for `counts.repost` (demo-feedback DF-19): one aggregated row per
 *                post of mine. A repost names no one: neither the push nor the feed says WHO
 *                reposted, so the row never invents a name (see `notificationText`).
 * My own activity never notifies me (no row for my own reply under my own post, or for a
 * post of mine that names me). A post that is both a reply to mine and names me is ONE row,
 * a reply -- the mention would only restate it.
 *
 * INCREMENTAL, NOT RECOMPUTED. `ingest(post)` is O(1) per post (a Map lookup, and for a
 * stranger's post one anchored regex test); it never rescans what it has already seen. The
 * state is a handful of Maps: `mine` (my posts), `groups` (one per row of reply/mention),
 * `memberIndex` (event id -> group, for O(1) dedup and removal), `likes` (per-post
 * baselines). A 120-posts/min burst of unrelated posts therefore costs a lookup and a regex
 * per post and changes nothing; a burst of replies to ONE post grows ONE group (count +
 * newest-actors summary, recomputed lazily once per snapshot, not once per arrival). Building
 * a snapshot is O(groups), and the store coalesces snapshots -- so there is no per-arrival
 * O(n^2) anywhere on the path (SOC-071).
 *
 * MENTION STORMS (SOC-071). A top-level mention is its own post, so unlike replies it cannot
 * group by subject; the exercise fires bursts of them at the PIO on purpose. So: up to
 * MENTION_STORM_THRESHOLD mentions inside one MENTION_STORM_WINDOW_MS of SCENARIO time keep a
 * row each; MORE than that fold into ONE rolling storm row ("Keisha and 41 others mentioned
 * you") that opens its newest mention, counts as ONE unread group on the badge, and keeps
 * absorbing every mention within a window of its span until the burst stops. The rule reads
 * scenario ms only -- not arrival order, not wall-clock -- so a newest-first feed read and an
 * oldest-first stream of pushes produce the same rows. Storms are rows like any other: the
 * GROUPS_CAP bound, taken-down members, "Mark all read" and the announcements all apply.
 *
 * COUNTS ARRIVE WITH A READ OR AN ENGAGEMENT PUSH. A pushed POST carries the counts it had when
 * it was broadcast; for a post already known to be mine they are ignored (see `ingest`). Counts
 * move through a feed read, or (demo-feedback DF-19) through {@link observeEngagement}: a
 * `PostEngagementChanged` frame for one of my posts, applied only when its `version` is higher
 * than the last frame applied to that post, so a replayed or stale frame never notifies twice and
 * a like or repost is announced the moment it lands instead of on the next 30 s read. A read and a
 * frame that both carry the same rise announce it once: the second sees no rise.
 *
 * A READ NEVER UNDOES A NEWER FRAME (Gate-1 M-1). Every applied frame bumps a tick; the store
 * captures {@link NotificationModel.readMark} when a feed read STARTS and passes it to
 * {@link NotificationModel.ingestBatch}. A post of mine whose last frame was applied after that
 * read started keeps the frame's counts: the read's are older, and letting them through would
 * withdraw the notification the frame raised and re-announce it on the next fresh read.
 *
 * MY OWN LIKE / REPOST IS SILENT (Gate-1 M-2). When the viewer starts liking or reposting a post,
 * the store tells the model ({@link NotificationModel.noteOwnReaction}); if the post is mine, the
 * next rise of that count (from the frame, or a read) absorbs one step into the baseline instead of
 * notifying. A write that fails or changes nothing withdraws it (`cancelOwnReaction`). It is never
 * persisted.
 *
 * REPOST RECORDS ride in the same bounded, persisted record list as the like records, under the
 * key `repost:<postId>` (the like record keeps the bare post id), so the persisted shape is
 * unchanged and an old stored state loads as-is (its posts simply have no repost baseline yet).
 *
 * IDEMPOTENT. Every post carries an id, and re-offering one (the baseline read, a realtime
 * echo, the 30 s re-read) never double-counts. The 30 s re-read feeds the same `ingest`.
 *
 * LIKES AND THE BASELINE (the story's rule: "first load establishes the baseline (no
 * retroactive new likes)"). For each post of mine the model keeps `baseline`: the like count
 * when the viewer last looked. A post with no baseline when first SEEN gets its current count
 * as the baseline, so the first load never invents likes; afterwards `pending = count -
 * baseline`. "Mark all read" moves the baseline up to the current count and keeps the
 * acknowledged row. If the count falls below the baseline (an unlike) the baseline follows it
 * down, so a later rise is still noticed. The time of a like row is the scenario instant the
 * rise was first SEEN (`now()`, the exercise clock): the server sends no like timestamps.
 *
 * REMOVAL. `remove(id)` drops a taken-down post from wherever it is: as an event in a group,
 * as one of mine (its like row goes), and as a subject (the replies/mentions under it go --
 * opening them would land on a tombstone). The store calls it for every id in `removedPosts`.
 *
 * XC-002. It only ever sees `ParticipantPostView`s (provenance is structurally absent), and
 * keeps just ids, a persona id, an instant and a <=140-character excerpt per event.
 */

import type { ParticipantPostView } from '../types/post'
import {
  ACTOR_PREVIEW_MAX,
  EXCERPT_MAX_LENGTH,
  GROUPS_CAP,
  LIKE_RECORDS_CAP,
  MENTION_STORM_THRESHOLD,
  MENTION_STORM_WINDOW_MS,
  MINE_CAP,
  READ_IDS_CAP,
  type EngagementObservation,
  type IngestResult,
  type NotificationEvent,
  type NotificationItem,
} from './notificationTypes'
import type { LikeRecord, PersistedNotifications } from './notificationStorage'

/** What the model needs to know about the viewer and its environment. */
export interface NotificationModelOptions {
  /** The session persona: "mine" means authored by this persona id. */
  readonly selfPersonaId: string
  /** The session persona's handle, without the `@` (mention matching). */
  readonly selfHandle: string
  /** The stored state for this viewer (see `notificationStorage`). */
  readonly persisted: PersistedNotifications
  /** The current scenario-time ISO instant (the exercise clock -- never wall-clock). */
  readonly now: () => string
  /** True for a post that has been taken down; it is never ingested. */
  readonly isRemoved: (postId: string) => boolean
}

/** No change -- shared, so the common "unrelated post" path allocates nothing. */
const NO_CHANGE: IngestResult = { changed: false }

/** No change from an engagement frame. */
const NO_OBSERVATION: EngagementObservation = { changed: false, events: [] }

/** The counted kinds a row is kept per own post for. */
type CountKind = 'like' | 'repost'

/** A counted kind's record key: a like keeps the bare post id (stored shape), a repost a prefix. */
function recordKey(kind: CountKind, postId: string): string {
  return kind === 'like' ? postId : `repost:${postId}`
}

/** What offering one post produced: whether anything changed, and every new unread event. */
interface Offered {
  readonly changed: boolean
  readonly events: readonly NotificationEvent[]
}

const NOTHING_OFFERED: Offered = { changed: false, events: [] }

function offered(result: IngestResult): Offered {
  if (result.event !== undefined) return { changed: result.changed, events: [result.event] }
  return result.changed ? { changed: true, events: [] } : NOTHING_OFFERED
}

/** One reply/mention event inside a group. */
interface Member {
  readonly actorId: string
  readonly at: string
  readonly ms: number
  readonly excerpt: string
}

/**
 * How a group came to be one row:
 *  - `subject`  every event of one type about one subject post (replies to my post; mentions
 *               that are replies under the same post);
 *  - `loose`    ONE top-level mention, its own post being the subject (a candidate for a storm);
 *  - `storm`    a rolling run of top-level mentions folded into one row (see the module header).
 */
type GroupKind = 'subject' | 'loose' | 'storm'

/** One reply/mention row: every event it stands for. */
interface Group {
  readonly key: string
  readonly kind: GroupKind
  readonly type: 'reply' | 'mention'
  /** What the row opens. For a storm this is only a seed: the row opens its NEWEST mention. */
  readonly subjectPostId: string
  readonly subjectHandle: string | undefined
  readonly members: Map<string, Member>
  /** Scenario ms of the oldest member (a storm's span starts here). */
  oldestMs: number
  /** Scenario ms of the newest member (what the group is ranked by when the cap bites). */
  newestMs: number
  /** The derived item; `undefined` when a member changed and it must be rebuilt. */
  item: NotificationItem | undefined
}

/** One of my posts: what the like / repost rows and the thread URL need. */
interface MyPost {
  readonly excerpt: string
  /** The like count last seen. */
  likes: number
  /** The repost count last seen. */
  reposts: number
  /** The `version` of the newest engagement frame applied to this post (-1: none yet). */
  version: number
  /** The model's frame tick when a frame was last applied to this post (0: never). */
  frameTick: number
}

/** Collapses whitespace and truncates to the excerpt length (adds an ellipsis when cut). */
export function toExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_MAX_LENGTH
    ? flat
    : `${flat.slice(0, EXCERPT_MAX_LENGTH - 1).trimEnd()}…`
}

/**
 * A matcher for "this text names `handle`": `@handle`, case-insensitive, with the `@` not
 * glued to a preceding word character or another `@` (so an e-mail address or `@@x` is not a
 * mention) and the
 * handle not continuing into more handle characters (so `@dreyes_fhx` is somebody else).
 * An empty handle matches nothing.
 */
export function mentionMatcher(handle: string): (text: string) => boolean {
  const bare = handle.replace(/^@+/, '')
  if (bare === '') return () => false
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_@])@${escaped}(?![A-Za-z0-9_])`, 'i')
  return text => pattern.test(text)
}

/** Epoch ms of an ISO instant (`Date.parse` reads the given string -- not the wall clock). */
function toMs(instant: string): number {
  const ms = Date.parse(instant)
  return Number.isNaN(ms) ? -Infinity : ms
}

/** Same row, same content -- so the model can hand back the previous object. */
function sameItem(a: NotificationItem, b: NotificationItem): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.subjectPostId === b.subjectPostId &&
    a.subjectHandle === b.subjectHandle &&
    a.at === b.at &&
    a.unread === b.unread &&
    a.count === b.count &&
    a.actorCount === b.actorCount &&
    a.excerpt === b.excerpt &&
    a.actorIds.length === b.actorIds.length &&
    a.actorIds.every((id, index) => id === b.actorIds[index])
  )
}

export class NotificationModel {
  private readonly selfPersonaId: string
  private readonly selfHandle: string
  private readonly now: () => string
  private readonly isRemoved: (postId: string) => boolean
  private readonly mentions: (text: string) => boolean

  /** My posts, by id. */
  private readonly mine = new Map<string, MyPost>()
  /** Reply/mention groups, by `${type}:${subjectPostId}`. */
  private readonly groups = new Map<string, Group>()
  /** Event id -> the key of the group holding it. */
  private readonly memberIndex = new Map<string, string>()
  /** The `loose` groups (single top-level mentions), ascending by scenario ms. */
  private readonly loose: Group[] = []
  /** The `storm` groups (few: each is a whole burst). */
  private readonly storms: Group[] = []
  /** Per-post like bookkeeping (insertion-ordered, so the oldest can be forgotten). */
  private readonly likes = new Map<string, LikeRecord>()
  /** Read event ids (insertion-ordered, so the oldest can be forgotten). */
  private readonly readIds = new Set<string>()
  /** Rows handed out last time, to return the SAME object for an unchanged row. */
  private lastItems = new Map<string, NotificationItem>()
  /**
   * The newest scenario ms among groups the cap has evicted. Anything at or below it, offered
   * while the model is full, would only be ranked out again -- so it is ignored up front, which
   * also keeps a re-read of the feed from "discovering" (and announcing) an evicted row again.
   */
  private evictedFloorMs = -Infinity
  /** Bumped by every applied engagement frame (see `readMark`). */
  private frameTick = 0
  /** My own likes / reposts not yet absorbed, by record key (see `noteOwnReaction`). */
  private readonly ownPending = new Map<string, number>()
  /** Whether the persisted part (read ids / like records) changed since `takeDirty`. */
  private dirty = false

  constructor(options: NotificationModelOptions) {
    this.selfPersonaId = options.selfPersonaId
    this.selfHandle = options.selfHandle
    this.now = options.now
    this.isRemoved = options.isRemoved
    this.mentions = mentionMatcher(options.selfHandle)
    for (const id of options.persisted.readIds) this.readIds.add(id)
    for (const record of options.persisted.likes) this.likes.set(record.postId, record)
  }

  // -------------------------------------------------------------------------
  // Ingest
  // -------------------------------------------------------------------------

  /**
   * Offers one post that ARRIVED (a realtime push, or the echo of a post just published). Safe
   * to call any number of times for the same post. For a feed read use {@link ingestBatch},
   * which learns which posts are mine FIRST so the newest-first order of a feed cannot hide a
   * reply behind its (older) parent.
   *
   * COUNTS ON AN ARRIVAL ARE IGNORED for a post already in "mine". A push carries the counts the
   * post had when it was broadcast -- never a like (`PostReceived` has none) -- and a late or
   * repeated one can be OLDER than what a read has already shown. Letting it through would drag
   * a like count, and with it the baseline, DOWN, and the next read would then report likes the
   * viewer had already seen. Only a feed READ may move a count.
   */
  ingest(post: ParticipantPostView): IngestResult {
    const result = this.offer(post, false)
    const [event] = result.events
    if (event !== undefined) return { changed: result.changed, event }
    return result.changed ? { changed: true } : NO_CHANGE
  }

  /**
   * Offers a batch (a feed read): my own posts first, then everyone else's. Returns the
   * NEW unread events, in order -- what the store announces for a re-read.
   */
  ingestBatch(posts: readonly ParticipantPostView[], readMark?: number): NotificationEvent[] {
    const events: NotificationEvent[] = []
    for (const post of posts) {
      if (post.authorPersonaId !== this.selfPersonaId) continue
      events.push(...this.offer(post, true, readMark).events)
    }
    for (const post of posts) {
      if (post.authorPersonaId === this.selfPersonaId) continue
      events.push(...this.offer(post, true).events)
    }
    return events
  }

  /**
   * The frame tick to capture when a feed read STARTS and hand back to {@link ingestBatch}: a post
   * of mine whose frame was applied after it keeps the frame's (newer) counts (Gate-1 M-1).
   */
  readMark(): number {
    return this.frameTick
  }

  /**
   * The viewer started liking / reposting `postId` (Gate-1 M-2). If the post is mine, the next rise
   * of that count absorbs one step silently into the baseline - my own reaction never notifies me.
   */
  noteOwnReaction(postId: string, kind: CountKind): void {
    if (!this.mine.has(postId)) return
    const key = recordKey(kind, postId)
    this.ownPending.set(key, (this.ownPending.get(key) ?? 0) + 1)
  }

  /** Withdraws a {@link noteOwnReaction} whose write failed or changed nothing. */
  cancelOwnReaction(postId: string, kind: CountKind): void {
    const key = recordKey(kind, postId)
    const pending = this.ownPending.get(key) ?? 0
    if (pending <= 1) this.ownPending.delete(key)
    else this.ownPending.set(key, pending - 1)
  }

  /**
   * Applies a `PostEngagementChanged` frame (demo-feedback DF-19) to one of MY posts: the like and
   * repost counts move exactly as a read would move them (rises are announced, an unlike lowers the
   * baseline), but only when `version` is higher than the last frame applied to that post, so a
   * replayed, duplicated or reordered frame changes nothing and never notifies twice. A frame for a
   * post that is not (yet) known to be mine is ignored: the next read baselines it. The reply count
   * is not read here -- replies notify through the arriving reply itself, which names its author.
   */
  observeEngagement(
    postId: string,
    counts: { readonly like: number; readonly repost: number },
    version: number,
  ): EngagementObservation {
    if (this.isRemoved(postId)) return NO_OBSERVATION
    const own = this.mine.get(postId)
    if (own === undefined || version <= own.version) return NO_OBSERVATION
    own.version = version
    this.frameTick += 1
    own.frameTick = this.frameTick
    const result = this.applyCounts(postId, own, counts.like, counts.repost)
    return result.changed || result.events.length > 0 ? result : NO_OBSERVATION
  }

  private offer(post: ParticipantPostView, fromRead: boolean, readMark?: number): Offered {
    if (this.isRemoved(post.id)) return NOTHING_OFFERED
    if (post.authorPersonaId === this.selfPersonaId) {
      if (!fromRead && this.mine.has(post.id)) return NOTHING_OFFERED
      // M-1: a read that started before this post's last frame carries older counts.
      const known = this.mine.get(post.id)
      if (known !== undefined && readMark !== undefined && known.frameTick > readMark) {
        return NOTHING_OFFERED
      }
      return this.observeOwn(post)
    }
    return offered(this.observeOther(post))
  }

  /** One of MY posts: remember it, and track how its like and repost counts moved. */
  private observeOwn(post: ParticipantPostView): Offered {
    const known = this.mine.get(post.id)
    if (known === undefined) {
      const own: MyPost = {
        excerpt: toExcerpt(post.text),
        likes: post.counts.like,
        reposts: post.counts.repost,
        version: -1,
        frameTick: 0,
      }
      this.mine.set(post.id, own)
      if (this.mine.size > MINE_CAP) {
        const oldest = this.mine.keys().next()
        if (oldest.done !== true) this.mine.delete(oldest.value)
      }
      // First sight: track both counts with no previous value (they become the baselines).
      const like = this.trackCount('like', post.id, undefined, own.likes)
      const repost = this.trackCount('repost', post.id, undefined, own.reposts)
      return { changed: true, events: [...like.events, ...repost.events] }
    }
    return this.applyCounts(post.id, known, post.counts.like, post.counts.repost)
  }

  /** Moves a known own post's like and repost counts to the given values (a read or a frame). */
  private applyCounts(postId: string, own: MyPost, like: number, repost: number): Offered {
    const previousLikes = own.likes
    const previousReposts = own.reposts
    own.likes = like
    own.reposts = repost
    const likeResult = this.trackCount('like', postId, previousLikes, like)
    const repostResult = this.trackCount('repost', postId, previousReposts, repost)
    const changed = previousLikes !== like || previousReposts !== repost
      || likeResult.changed || repostResult.changed
    const events = [...likeResult.events, ...repostResult.events]
    if (!changed && events.length === 0) return NOTHING_OFFERED
    return { changed: true, events }
  }

  /**
   * The baseline bookkeeping for one counted kind of one of my posts (the like rule, shared by the
   * repost row): the first count seen is the baseline (no retroactive rows); a count below the
   * baseline (an unlike / un-repost) pulls it down so the next rise is still noticed; a rise SEEN
   * in this session (`value > previous`) is an event of that size, stamped `riseAt` now.
   */
  private trackCount(
    kind: CountKind,
    postId: string,
    previous: number | undefined,
    value: number,
  ): Offered {
    const key = recordKey(kind, postId)
    let changed = false
    let record = this.likes.get(key)
    if (record === undefined) {
      // First sight: this count IS the baseline -- no retroactive likes / reposts.
      record = { postId: key, baseline: value }
      this.setLikeRecord(record)
      changed = true
    } else if (value < record.baseline) {
      // Someone unliked / un-reposted: follow the count down so the next rise is still noticed.
      record = { postId: key, baseline: value, ...(record.read ? { read: record.read } : {}) }
      this.setLikeRecord(record)
      changed = true
    }

    // A rise SEEN in this session (not merely a higher count than a stored baseline).
    let amount = previous !== undefined && value > previous ? value - previous : 0

    // M-2: the part of the rise that is MY OWN like / repost moves the baseline silently.
    const own = this.ownPending.get(key) ?? 0
    if (amount > 0 && own > 0) {
      const absorbed = Math.min(own, amount)
      amount -= absorbed
      if (own - absorbed > 0) this.ownPending.set(key, own - absorbed)
      else this.ownPending.delete(key)
      record = { ...record, baseline: record.baseline + absorbed }
      this.setLikeRecord(record)
      changed = true
    }

    if (value > record.baseline) {
      if (amount > 0 || record.riseAt === undefined) {
        // Stamp when the rise was first seen; a reloaded rise that already has a stamp keeps it.
        record = { ...record, riseAt: this.now() }
        this.setLikeRecord(record)
        changed = true
      }
    } else if (record.riseAt !== undefined) {
      record = {
        postId: key,
        baseline: record.baseline,
        ...(record.read ? { read: record.read } : {}),
      }
      this.setLikeRecord(record)
      changed = true
    }

    if (amount > 0) return { changed: true, events: [{ type: kind, amount }] }
    return changed ? { changed: true, events: [] } : NOTHING_OFFERED
  }

  /** Someone else's post: a reply to one of mine, else a mention of me, else nothing. */
  private observeOther(post: ParticipantPostView): IngestResult {
    if (this.memberIndex.has(post.id)) return NO_CHANGE // already counted

    const parent = post.inReplyTo
    if (parent != null && this.mine.has(parent.postId)) {
      return this.addMember('reply', parent.postId, this.selfHandle, post)
    }
    if (this.mentions(post.text)) {
      return parent != null
        ? this.addMember('mention', parent.postId, parent.authorHandle, post)
        : this.addTopLevelMention(post)
    }
    return NO_CHANGE
  }

  private memberOf(post: ParticipantPostView, ms: number): Member {
    return {
      actorId: post.authorPersonaId,
      at: post.scenarioTime,
      ms,
      excerpt: toExcerpt(post.text),
    }
  }

  /** The result for a member that was just added: an event only when it is unread. */
  private addedResult(type: 'reply' | 'mention', postId: string): IngestResult {
    return this.readIds.has(postId)
      ? { changed: true }
      : { changed: true, event: { type, amount: 1 } }
  }

  /** A reply to my post, or a mention that is itself a reply: grouped by SUBJECT post. */
  private addMember(
    type: 'reply' | 'mention',
    subjectPostId: string,
    subjectHandle: string | undefined,
    post: ParticipantPostView,
  ): IngestResult {
    const key = `${type}:${subjectPostId}`
    const ms = toMs(post.scenarioTime)
    let group = this.groups.get(key)
    if (group === undefined) {
      // A full model ignores what it would only rank straight out again (see evictedFloorMs).
      if (this.groups.size >= GROUPS_CAP && ms <= this.evictedFloorMs) return NO_CHANGE
      group = {
        key,
        kind: 'subject',
        type,
        subjectPostId,
        subjectHandle,
        members: new Map(),
        oldestMs: ms,
        newestMs: ms,
        item: undefined,
      }
      this.groups.set(key, group)
    }
    group.members.set(post.id, this.memberOf(post, ms))
    if (ms > group.newestMs) group.newestMs = ms
    if (ms < group.oldestMs) group.oldestMs = ms
    group.item = undefined
    this.memberIndex.set(post.id, key)
    if (this.groups.size > GROUPS_CAP && this.evictOldestGroup() === group) return NO_CHANGE
    return this.addedResult(type, post.id)
  }

  // ---- mention storms (SOC-071) --------------------------------------------

  /**
   * A TOP-LEVEL mention: its own post is the subject, so it cannot group by subject. It is a
   * `loose` row of its own until more than MENTION_STORM_THRESHOLD loose mentions fall inside
   * one MENTION_STORM_WINDOW_MS window of scenario time; then they fold into a `storm` group,
   * which keeps absorbing every mention within the window of its span (so it ROLLS with the
   * burst and ends once the mentions stop for a window). The decision uses scenario ms only, so
   * it does not depend on the order posts are offered in (a feed read is newest-first, a push
   * oldest-first) or on how fast they arrive on the wall clock.
   */
  private addTopLevelMention(post: ParticipantPostView): IngestResult {
    const ms = toMs(post.scenarioTime)

    const storm = this.stormCovering(ms)
    if (storm !== undefined) {
      storm.members.set(post.id, this.memberOf(post, ms))
      storm.item = undefined
      this.memberIndex.set(post.id, storm.key)
      this.growStorm(storm, ms)
      return this.addedResult('mention', post.id)
    }

    const key = `mention:${post.id}`
    // A full model ignores what it would only rank straight out again (see evictedFloorMs).
    if (this.groups.size >= GROUPS_CAP && ms <= this.evictedFloorMs) return NO_CHANGE
    const group: Group = {
      key,
      kind: 'loose',
      type: 'mention',
      subjectPostId: post.id,
      subjectHandle: undefined,
      members: new Map([[post.id, this.memberOf(post, ms)]]),
      oldestMs: ms,
      newestMs: ms,
      item: undefined,
    }
    this.groups.set(key, group)
    this.insertLoose(group)
    this.memberIndex.set(post.id, key)

    if (!this.tryFormStorm(ms) && this.groups.size > GROUPS_CAP) {
      if (this.evictOldestGroup() === group) return NO_CHANGE
    }
    return this.addedResult('mention', post.id)
  }

  /** The storm whose span, widened by the window on both sides, contains `ms`. */
  private stormCovering(ms: number): Group | undefined {
    return this.storms.find(
      storm => ms >= storm.oldestMs - MENTION_STORM_WINDOW_MS
        && ms <= storm.newestMs + MENTION_STORM_WINDOW_MS,
    )
  }

  /** Index of the first `loose` group whose ms is >= `ms` (binary search; `loose` is sorted). */
  private lowerBound(ms: number): number {
    let low = 0
    let high = this.loose.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((this.loose[mid]?.newestMs ?? Infinity) < ms) low = mid + 1
      else high = mid
    }
    return low
  }

  private insertLoose(group: Group): void {
    // After any equal ms, so equal-ms groups keep their arrival order.
    let low = 0
    let high = this.loose.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((this.loose[mid]?.newestMs ?? Infinity) <= group.newestMs) low = mid + 1
      else high = mid
    }
    this.loose.splice(low, 0, group)
  }

  /**
   * Looks for MORE than MENTION_STORM_THRESHOLD loose mentions inside one window that includes
   * `ms` (the one just added) and folds them into a new storm. O(log n + k), k being the loose
   * mentions within two windows -- which is at most a handful, because a seventh would already
   * have made a storm. Returns whether a storm formed.
   */
  private tryFormStorm(ms: number): boolean {
    const first = this.lowerBound(ms - MENTION_STORM_WINDOW_MS)
    for (let start = first; start < this.loose.length; start += 1) {
      const startMs = this.loose[start]?.newestMs
      if (startMs === undefined || startMs > ms) break
      if (ms > startMs + MENTION_STORM_WINDOW_MS) continue
      let end = start
      while (
        end + 1 < this.loose.length
        && (this.loose[end + 1]?.newestMs ?? Infinity) <= startMs + MENTION_STORM_WINDOW_MS
      ) end += 1
      if (end - start + 1 > MENTION_STORM_THRESHOLD) {
        this.formStorm(this.loose.slice(start, end + 1))
        return true
      }
    }
    return false
  }

  /** Folds loose groups into one new storm group, then lets it absorb what it now touches. */
  private formStorm(folded: readonly Group[]): void {
    const seed = folded[0]
    if (seed === undefined) return
    const storm: Group = {
      key: `mention-storm:${seed.subjectPostId}`,
      kind: 'storm',
      type: 'mention',
      subjectPostId: seed.subjectPostId,
      subjectHandle: undefined,
      members: new Map(),
      oldestMs: Infinity,
      newestMs: -Infinity,
      item: undefined,
    }
    this.groups.set(storm.key, storm)
    this.storms.push(storm)
    for (const group of folded) this.foldInto(storm, group)
    this.growStorm(storm, storm.newestMs)
  }

  /** Moves every member of `from` into `storm` and removes `from` as a row of its own. */
  private foldInto(storm: Group, from: Group): void {
    this.detach(from)
    for (const [id, member] of from.members) {
      storm.members.set(id, member)
      this.memberIndex.set(id, storm.key)
      if (member.ms < storm.oldestMs) storm.oldestMs = member.ms
      if (member.ms > storm.newestMs) storm.newestMs = member.ms
    }
    storm.item = undefined
  }

  /**
   * After a member joined (or a storm formed) at `ms`: widen the span, then absorb every loose
   * mention and every other storm now within the window of it, until nothing more touches.
   */
  private growStorm(storm: Group, ms: number): void {
    if (ms < storm.oldestMs) storm.oldestMs = ms
    if (ms > storm.newestMs) storm.newestMs = ms
    let grew = true
    while (grew) {
      grew = false
      const low = storm.oldestMs - MENTION_STORM_WINDOW_MS
      const high = storm.newestMs + MENTION_STORM_WINDOW_MS
      for (
        let index = this.lowerBound(low);
        index < this.loose.length && (this.loose[index]?.newestMs ?? Infinity) <= high;
      ) {
        const near = this.loose[index]
        if (near === undefined) break
        this.foldInto(storm, near) // removes it from `loose`: the next one is at `index` now
        grew = true
      }
      for (const other of [...this.storms]) {
        if (other === storm) continue
        if (other.newestMs < low || other.oldestMs > high) continue
        this.foldInto(storm, other)
        grew = true
      }
    }
  }

  /** Removes a group as a row (from the map and the loose/storm indexes) -- members untouched. */
  private detach(group: Group): void {
    this.groups.delete(group.key)
    if (group.kind === 'loose') {
      const at = this.loose.indexOf(group)
      if (at >= 0) this.loose.splice(at, 1)
    } else if (group.kind === 'storm') {
      const at = this.storms.indexOf(group)
      if (at >= 0) this.storms.splice(at, 1)
    }
  }

  /** Removes a group AND forgets that its members were ever counted. */
  private dropGroup(group: Group): void {
    for (const id of group.members.keys()) this.memberIndex.delete(id)
    this.detach(group)
  }

  /**
   * Drops the group whose newest event is oldest (ties: the one inserted first) and returns
   * it. O(groups) with groups <= GROUPS_CAP + 1, so a constant per NEW group -- never per
   * post -- however long the session runs.
   */
  private evictOldestGroup(): Group | undefined {
    let oldest: Group | undefined
    for (const group of this.groups.values()) {
      if (oldest === undefined || group.newestMs < oldest.newestMs) oldest = group
    }
    if (oldest === undefined) return undefined
    this.dropGroup(oldest)
    if (oldest.newestMs > this.evictedFloorMs) this.evictedFloorMs = oldest.newestMs
    return oldest
  }

  // -------------------------------------------------------------------------
  // Removal and "Mark all read"
  // -------------------------------------------------------------------------

  /**
   * Forgets a taken-down post wherever it appears (see the module header). Returns whether
   * anything visible changed.
   */
  remove(postId: string): boolean {
    let changed = false

    const memberKey = this.memberIndex.get(postId)
    if (memberKey !== undefined) {
      this.memberIndex.delete(postId)
      const group = this.groups.get(memberKey)
      if (group !== undefined) {
        group.members.delete(postId)
        group.item = undefined
        if (group.members.size === 0) this.detach(group)
      }
      changed = true
    }

    if (this.mine.delete(postId)) {
      if (this.likes.delete(recordKey('like', postId))) this.dirty = true
      if (this.likes.delete(recordKey('repost', postId))) this.dirty = true
      changed = true
    }

    // A taken-down SUBJECT takes its rows with it: they would open a tombstone.
    for (const type of ['reply', 'mention'] as const) {
      const key = `${type}:${postId}`
      const group = this.groups.get(key)
      if (group === undefined) continue
      this.dropGroup(group)
      changed = true
    }
    return changed
  }

  /**
   * Marks every current row read: all reply/mention events are remembered as read, and each
   * pending like / repost row becomes an acknowledged one with the baseline moved up to the count.
   */
  markAllRead(): void {
    for (const group of this.groups.values()) {
      for (const id of group.members.keys()) this.rememberRead(id)
      group.item = undefined
    }
    for (const [postId, post] of this.mine) {
      this.acknowledge(recordKey('like', postId), post.likes)
      this.acknowledge(recordKey('repost', postId), post.reposts)
    }
    this.dirty = true
  }

  /** Moves one counted record's baseline up to `count`; what was pending becomes the read row. */
  private acknowledge(key: string, count: number): void {
    const record = this.likes.get(key)
    if (record === undefined) return
    const pending = Math.max(0, count - record.baseline)
    if (pending === 0) return
    this.setLikeRecord({
      postId: key,
      baseline: count,
      read: { count: pending, at: record.riseAt ?? this.now() },
    })
  }

  /**
   * Remembers an event as read. NOT capped: the live set must keep every event the current
   * rows are made of, or "Mark all read" would leave the oldest of a long group unread and the
   * badge stuck above zero. Only what is WRITTEN to storage is bounded (see `toPersisted`); the
   * live set is as large as the (bounded) groups it describes plus what was loaded.
   */
  private rememberRead(id: string): void {
    this.readIds.delete(id) // re-insert at the newest end
    this.readIds.add(id)
    this.dirty = true
  }

  private setLikeRecord(record: LikeRecord): void {
    this.likes.delete(record.postId) // re-insert at the newest end
    this.likes.set(record.postId, record)
    if (this.likes.size > LIKE_RECORDS_CAP) {
      const oldest = this.likes.keys().next()
      if (oldest.done !== true) this.likes.delete(oldest.value)
    }
    this.dirty = true
  }

  // -------------------------------------------------------------------------
  // Read side
  // -------------------------------------------------------------------------

  /**
   * Every row, newest first (ties broken by id so the order is stable). Rows that did not
   * change since the last call are the SAME objects. O(groups + my posts).
   */
  items(): NotificationItem[] {
    const next = new Map<string, NotificationItem>()
    const sortKey = new Map<string, number>()

    for (const group of this.groups.values()) {
      const built = group.item ?? this.buildGroupItem(group)
      group.item = built
      const item = this.reuse(built)
      next.set(item.id, item)
      sortKey.set(item.id, toMs(item.at))
    }

    for (const [postId, post] of this.mine) {
      for (const kind of ['like', 'repost'] as const) {
        const record = this.likes.get(recordKey(kind, postId))
        if (record === undefined) continue
        const count = kind === 'like' ? post.likes : post.reposts
        const pending = Math.max(0, count - record.baseline)
        const row = pending > 0
          ? this.buildCountItem(kind, postId, post, pending, record.riseAt ?? this.now(), true)
          : record.read !== undefined
            ? this.buildCountItem(kind, postId, post, record.read.count, record.read.at, false)
            : undefined
        if (row === undefined) continue
        const item = this.reuse(row)
        next.set(item.id, item)
        sortKey.set(item.id, toMs(item.at))
      }
    }

    this.lastItems = next
    return [...next.values()].sort((a, b) => {
      const delta = (sortKey.get(b.id) ?? -Infinity) - (sortKey.get(a.id) ?? -Infinity)
      return delta !== 0 ? delta : a.id.localeCompare(b.id)
    })
  }

  /** The previous object for an unchanged row, else the new one. */
  private reuse(built: NotificationItem): NotificationItem {
    const previous = this.lastItems.get(built.id)
    return previous !== undefined && sameItem(previous, built) ? previous : built
  }

  private buildGroupItem(group: Group): NotificationItem {
    let newest: Member | undefined
    let newestId: string | undefined
    let unread = false
    const lastSeenByActor = new Map<string, number>()
    for (const [id, member] of group.members) {
      if (newest === undefined || member.ms > newest.ms) {
        newest = member
        newestId = id
      }
      if (!this.readIds.has(id)) unread = true
      const seen = lastSeenByActor.get(member.actorId)
      if (seen === undefined || member.ms > seen) lastSeenByActor.set(member.actorId, member.ms)
    }
    const actors = [...lastSeenByActor.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, ACTOR_PREVIEW_MAX)
      .map(([actorId]) => actorId)
    return {
      id: group.key,
      type: group.type,
      // A storm has no single subject: the row opens its NEWEST mention (whose author is
      // `actorIds[0]`, so the URL's cosmetic handle can still be a real one).
      subjectPostId: group.kind === 'storm' ? (newestId ?? group.subjectPostId) : group.subjectPostId,
      subjectHandle: group.subjectHandle,
      at: newest?.at ?? '',
      unread,
      count: group.members.size,
      actorIds: actors,
      actorCount: lastSeenByActor.size,
      excerpt: newest?.excerpt ?? '',
    }
  }

  /** A like or repost row: anonymous (no actor is known), one per post of mine. */
  private buildCountItem(
    kind: CountKind,
    postId: string,
    post: MyPost,
    count: number,
    at: string,
    unread: boolean,
  ): NotificationItem {
    return {
      id: `${kind}:${postId}`,
      type: kind,
      subjectPostId: postId,
      subjectHandle: this.selfHandle,
      at,
      unread,
      count,
      actorIds: [],
      actorCount: 0,
      excerpt: post.excerpt,
    }
  }

  /**
   * The state to persist. Returns it whether or not it changed; {@link takeDirty} says
   * whether writing is needed.
   */
  toPersisted(): PersistedNotifications {
    return {
      v: 1,
      // Bounded here, on the way out: the newest READ_IDS_CAP, never trimmed from the live set.
      readIds: [...this.readIds].slice(-READ_IDS_CAP),
      likes: [...this.likes.values()],
    }
  }

  /** True once if the persisted part changed since the last call. */
  takeDirty(): boolean {
    const was = this.dirty
    this.dirty = false
    return was
  }
}
