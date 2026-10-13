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
 *                viewer last looked ("Your post got 3 new likes").
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
  LIKE_RECORDS_CAP,
  READ_IDS_CAP,
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

/** One reply/mention event inside a group. */
interface Member {
  readonly actorId: string
  readonly at: string
  readonly ms: number
  readonly excerpt: string
}

/** One reply/mention row: every event of one type about one subject post. */
interface Group {
  readonly key: string
  readonly type: 'reply' | 'mention'
  readonly subjectPostId: string
  readonly subjectHandle: string | undefined
  readonly members: Map<string, Member>
  /** The derived item; `undefined` when a member changed and it must be rebuilt. */
  item: NotificationItem | undefined
}

/** One of my posts: what the like row and the thread URL need. */
interface MyPost {
  readonly excerpt: string
  /** The like count last seen. */
  likes: number
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
  /** Per-post like bookkeeping (insertion-ordered, so the oldest can be forgotten). */
  private readonly likes = new Map<string, LikeRecord>()
  /** Read event ids (insertion-ordered, so the oldest can be forgotten). */
  private readonly readIds = new Set<string>()
  /** Rows handed out last time, to return the SAME object for an unchanged row. */
  private lastItems = new Map<string, NotificationItem>()
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
   * Offers one post. Safe to call any number of times for the same post. For a batch (the
   * feed read) use {@link ingestBatch}, which learns which posts are mine FIRST so the
   * newest-first order of a feed cannot hide a reply behind its (older) parent.
   */
  ingest(post: ParticipantPostView): IngestResult {
    if (this.isRemoved(post.id)) return NO_CHANGE
    return post.authorPersonaId === this.selfPersonaId
      ? this.observeOwn(post)
      : this.observeOther(post)
  }

  /**
   * Offers a batch (a feed read): my own posts first, then everyone else's. Returns the
   * NEW unread events, in order -- what the store announces for a re-read.
   */
  ingestBatch(posts: readonly ParticipantPostView[]): NotificationEvent[] {
    const events: NotificationEvent[] = []
    for (const post of posts) {
      if (post.authorPersonaId !== this.selfPersonaId) continue
      const event = this.ingest(post).event
      if (event !== undefined) events.push(event)
    }
    for (const post of posts) {
      if (post.authorPersonaId === this.selfPersonaId) continue
      const event = this.ingest(post).event
      if (event !== undefined) events.push(event)
    }
    return events
  }

  /** One of MY posts: remember it, and track how its like count moved. */
  private observeOwn(post: ParticipantPostView): IngestResult {
    const like = post.counts.like
    const known = this.mine.get(post.id)
    const previous = known?.likes
    if (known === undefined) {
      this.mine.set(post.id, { excerpt: toExcerpt(post.text), likes: like })
    } else {
      known.likes = like
    }
    let changed = known === undefined || previous !== like

    let record = this.likes.get(post.id)
    if (record === undefined) {
      // First sight: this count IS the baseline -- no retroactive likes.
      record = { postId: post.id, baseline: like }
      this.setLikeRecord(record)
      changed = true
    } else if (like < record.baseline) {
      // Someone unliked: follow the count down so the next rise is still noticed.
      record = { postId: post.id, baseline: like, ...(record.read ? { read: record.read } : {}) }
      this.setLikeRecord(record)
      changed = true
    }

    // A rise SEEN in this session (not merely a higher count than a stored baseline).
    const rose = previous !== undefined && like > previous
    if (like > record.baseline) {
      if (rose || record.riseAt === undefined) {
        // Stamp when the rise was first seen; a reloaded rise that already has a stamp keeps it.
        record = { ...record, riseAt: this.now() }
        this.setLikeRecord(record)
        changed = true
      }
    } else if (record.riseAt !== undefined) {
      record = {
        postId: post.id,
        baseline: record.baseline,
        ...(record.read ? { read: record.read } : {}),
      }
      this.setLikeRecord(record)
      changed = true
    }

    if (rose) return { changed: true, event: { type: 'like', amount: like - previous } }
    return changed ? { changed } : NO_CHANGE
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
        : this.addMember('mention', post.id, undefined, post)
    }
    return NO_CHANGE
  }

  private addMember(
    type: 'reply' | 'mention',
    subjectPostId: string,
    subjectHandle: string | undefined,
    post: ParticipantPostView,
  ): IngestResult {
    const key = `${type}:${subjectPostId}`
    let group = this.groups.get(key)
    if (group === undefined) {
      group = {
        key,
        type,
        subjectPostId,
        subjectHandle,
        members: new Map(),
        item: undefined,
      }
      this.groups.set(key, group)
    }
    group.members.set(post.id, {
      actorId: post.authorPersonaId,
      at: post.scenarioTime,
      ms: toMs(post.scenarioTime),
      excerpt: toExcerpt(post.text),
    })
    group.item = undefined
    this.memberIndex.set(post.id, key)
    return this.readIds.has(post.id)
      ? { changed: true }
      : { changed: true, event: { type, amount: 1 } }
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
        if (group.members.size === 0) this.groups.delete(memberKey)
      }
      changed = true
    }

    if (this.mine.delete(postId)) {
      if (this.likes.delete(postId)) this.dirty = true
      changed = true
    }

    // A taken-down SUBJECT takes its rows with it: they would open a tombstone.
    for (const type of ['reply', 'mention'] as const) {
      const key = `${type}:${postId}`
      const group = this.groups.get(key)
      if (group === undefined) continue
      for (const id of group.members.keys()) this.memberIndex.delete(id)
      this.groups.delete(key)
      changed = true
    }
    return changed
  }

  /**
   * Marks every current row read: all reply/mention events are remembered as read, and each
   * pending like row becomes an acknowledged one with the baseline moved up to the count.
   */
  markAllRead(): void {
    for (const group of this.groups.values()) {
      for (const id of group.members.keys()) this.rememberRead(id)
      group.item = undefined
    }
    for (const [postId, post] of this.mine) {
      const record = this.likes.get(postId)
      if (record === undefined) continue
      const pending = Math.max(0, post.likes - record.baseline)
      if (pending === 0) continue
      this.setLikeRecord({
        postId,
        baseline: post.likes,
        read: { count: pending, at: record.riseAt ?? this.now() },
      })
    }
    this.dirty = true
  }

  private rememberRead(id: string): void {
    this.readIds.delete(id) // re-insert at the newest end
    this.readIds.add(id)
    if (this.readIds.size > READ_IDS_CAP) {
      const oldest = this.readIds.values().next()
      if (oldest.done !== true) this.readIds.delete(oldest.value)
    }
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
      const record = this.likes.get(postId)
      if (record === undefined) continue
      const pending = Math.max(0, post.likes - record.baseline)
      const row = pending > 0
        ? this.buildLikeItem(postId, post, pending, record.riseAt ?? this.now(), true)
        : record.read !== undefined
          ? this.buildLikeItem(postId, post, record.read.count, record.read.at, false)
          : undefined
      if (row === undefined) continue
      const item = this.reuse(row)
      next.set(item.id, item)
      sortKey.set(item.id, toMs(item.at))
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
    let unread = false
    const lastSeenByActor = new Map<string, number>()
    for (const [id, member] of group.members) {
      if (newest === undefined || member.ms > newest.ms) newest = member
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
      subjectPostId: group.subjectPostId,
      subjectHandle: group.subjectHandle,
      at: newest?.at ?? '',
      unread,
      count: group.members.size,
      actorIds: actors,
      actorCount: lastSeenByActor.size,
      excerpt: newest?.excerpt ?? '',
    }
  }

  private buildLikeItem(
    postId: string,
    post: MyPost,
    count: number,
    at: string,
    unread: boolean,
  ): NotificationItem {
    return {
      id: `like:${postId}`,
      type: 'like',
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
    return { v: 1, readIds: [...this.readIds], likes: [...this.likes.values()] }
  }

  /** True once if the persisted part changed since the last call. */
  takeDirty(): boolean {
    const was = this.dirty
    this.dirty = false
    return was
  }
}
