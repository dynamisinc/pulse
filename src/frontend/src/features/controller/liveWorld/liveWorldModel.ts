/**
 * features/controller/liveWorld/liveWorldModel.ts
 * ---------------------------------------------------------------------------
 * The PURE model behind the console's LIVE WORLD column (demo-polish C2,
 * docs/features/demo-polish/18-live-world-column.md; CTL-030, CTL-031 lite,
 * COR-001, XC-002, NFR-002 / SOC-071). STAFF world — no React, no MUI, no DOM,
 * no wall-clock. Everything that decides WHAT the column shows lives here as
 * plain functions so it can be unit-tested without rendering, and so the hook
 * (`useLiveWorldFeed`) and the component stay thin.
 *
 * ## What the column is made of
 * One `LiveWorldEntry` per post: the participant-safe `ParticipantPostView`
 * (already narrowed — a staff session reads the SAME payload a participant does,
 * XC-002; provenance is never on it), plus three values derived ONCE at
 * ingestion so a 300-row list never re-derives them per render:
 *   - `ts`   the scenario instant as epoch-ms (`Date.parse` of a GIVEN string —
 *            not a wall-clock read) for the newest-first sort;
 *   - `seq`  an arrival counter that breaks a same-instant tie deterministically
 *            (the later arrival sorts first);
 *   - `tags` the post's normalized hashtags, for the hashtag filter and the
 *            "tags seen" picker.
 *
 * ## Two collections: `rows` and `pending` (burst legibility)
 * The state is `{ rows, pending }`, both newest-first:
 *   - `rows`    what the column lists, bounded at {@link MAX_ROWS} (oldest fall
 *               off the tail);
 *   - `pending` arrivals held BEHIND the "N new" control while the controller is
 *               reading (scrolled down, or keyboard focus on a row below the
 *               top), bounded at {@link MAX_PENDING}. They never move the list
 *               until the controller asks (`mergePending`) or returns to the top.
 * Both are bounded so memory cannot grow without limit at the NFR-002 stress
 * load (120 posts/min); the oldest is evicted to admit the newest, the same
 * policy `useFeedStream`'s participant buffer uses.
 *
 * ## Ingestion is by id
 * `ingest` is the single write path for a batch of arrivals, a fetched baseline
 * and a polling-mode sweep alike. A post already in `rows`/`pending` is never
 * duplicated; its CONTENT is refreshed in place if it changed (a sweep brings
 * fresh counts) and left as the SAME object if it did not, so a memoized row
 * does not re-render for a no-op refresh.
 *
 * ## Staff projections
 * `toLiveWorldPost` joins a view with its author persona into the flat
 * `LiveWorldPost` the row renders and `renderRowActions` receives (C5's
 * `TakedownActionProps` is `{ post: LiveWorldPost }`). A post whose author the
 * directory doesn't know is NEVER dropped — a controller sees every post — it is
 * projected as "UNKNOWN AUTHOR · <short id>" with `authorUnknown: true`.
 * `toReplyTarget` builds the
 * `ReplyTarget` handed to `onReplyAs` (excerpt <= 140 characters, as the composer
 * contract requires). No `exerciseId` appears anywhere in this module (COR-001):
 * the session binds the exercise server-side.
 */

import type {
  ParticipantPostView,
  PostCounts,
  PostInReplyTo,
  PostMedia,
  ReplyTarget,
} from '@/features/social'
import type { Persona } from '@/features/personas'
import { formatDuration } from '@/features/social/components/media/formatDuration'
import { extractHashtags } from '@/features/social/utils/hashtags'

/** Most rows the column keeps. The feed read is `Take(200)`; the rest is live headroom. */
export const MAX_ROWS = 300

/** Most arrivals held behind the "N new" control before the oldest is evicted. */
export const MAX_PENDING = 300

/** Longest `ReplyTarget.excerpt` (the composer contract, implementation.md §1.11). */
export const REPLY_EXCERPT_MAX = 140

/** Most distinct hashtags offered in the filter picker. */
export const MAX_TAG_OPTIONS = 50

/**
 * One post as the column's rows and the `renderRowActions` slot see it: the
 * participant-safe post flattened together with its author. STAFF-side shape —
 * it deliberately carries no provenance (`origin`, `actingHumanId`, …): the feed
 * API is participant-safe and provenance display is out of scope (story 18).
 */
export interface LiveWorldPost {
  readonly id: string
  readonly authorPersonaId: string
  /** The author's handle WITHOUT a leading `@`. */
  readonly authorHandle: string
  readonly authorDisplayName: string
  readonly authorVerified: boolean
  /**
   * True ONLY when the author is not in the persona directory (see
   * {@link toLiveWorldPost}); then `authorDisplayName` is the staff label
   * "UNKNOWN AUTHOR · <short id>" and `authorHandle` a placeholder. Absent otherwise.
   */
  readonly authorUnknown?: true
  readonly text: string
  /** Scenario ISO instant (COR-053). */
  readonly scenarioTime: string
  readonly counts: PostCounts
  readonly media?: readonly PostMedia[]
  /** Present when this post is a reply. */
  readonly inReplyTo?: PostInReplyTo
}

/** A post in the column's collections, with the values derived once at ingestion. */
export interface LiveWorldEntry {
  readonly view: ParticipantPostView
  /** Scenario instant as epoch-ms; `-Infinity` when unparseable (sorts last). */
  readonly ts: number
  /** Arrival order; the higher `seq` sorts first among equal instants. */
  readonly seq: number
  /** Distinct normalized hashtags in the post text. */
  readonly tags: readonly string[]
}

/** The column's two collections (see the module header). Both newest-first. */
export interface LiveWorldState {
  readonly rows: readonly LiveWorldEntry[]
  readonly pending: readonly LiveWorldEntry[]
}

export const EMPTY_LIVE_WORLD_STATE: LiveWorldState = { rows: [], pending: [] }

/** The column's filter: everything (default), one hashtag, or one persona. */
export type LiveWorldFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'hashtag'; readonly tag: string }
  | { readonly kind: 'persona'; readonly personaId: string }

export const ALL_POSTS_FILTER: LiveWorldFilter = { kind: 'all' }

// -----------------------------------------------------------------------------
// Entries and ordering
// -----------------------------------------------------------------------------

/** Wraps a participant-safe view as an entry, deriving `ts` and `tags` once. */
export function toEntry(view: ParticipantPostView, seq: number): LiveWorldEntry {
  const parsed = Date.parse(view.scenarioTime)
  return {
    view,
    ts: Number.isNaN(parsed) ? -Infinity : parsed,
    seq,
    tags: extractHashtags(view.text),
  }
}

/** Newest-first by scenario instant; the later arrival first among equals. */
export function compareEntries(a: LiveWorldEntry, b: LiveWorldEntry): number {
  if (a.ts !== b.ts) {
    // `-Infinity - -Infinity` is NaN; the explicit branches keep the comparator total.
    if (a.ts === -Infinity) return 1
    if (b.ts === -Infinity) return -1
    return b.ts - a.ts
  }
  return b.seq - a.seq
}

/** True when two views would render identically (text, time, counts, media, reply link). */
function sameContent(a: ParticipantPostView, b: ParticipantPostView): boolean {
  if (a === b) return true
  if (a.text !== b.text || a.scenarioTime !== b.scenarioTime) return false
  if (
    a.counts.reply !== b.counts.reply ||
    a.counts.repost !== b.counts.repost ||
    a.counts.like !== b.counts.like ||
    a.counts.share !== b.counts.share
  ) {
    return false
  }
  if (a.inReplyTo?.postId !== b.inReplyTo?.postId) return false
  if (a.inReplyTo?.authorHandle !== b.inReplyTo?.authorHandle) return false
  const am = a.media ?? []
  const bm = b.media ?? []
  if (am.length !== bm.length) return false
  return am.every((item, i) => {
    const other = bm[i]
    return other !== undefined && item.id === other.id && item.url === other.url
      && item.posterUrl === other.posterUrl
  })
}

/** `entries` with `incoming` merged in, newest-first, bounded at `cap` (oldest dropped). */
function mergeSorted(
  entries: readonly LiveWorldEntry[],
  incoming: readonly LiveWorldEntry[],
  cap: number,
): readonly LiveWorldEntry[] {
  const merged = [...entries, ...incoming].sort(compareEntries)
  return merged.length > cap ? merged.slice(0, cap) : merged
}

/**
 * Replaces, by id, the entries of `list` whose content changed in `updates`
 * (keeping the existing `seq`/`ts`/`tags` when only counts or media moved).
 * Returns `list` itself when nothing changed.
 */
function refreshContent(
  list: readonly LiveWorldEntry[],
  updates: ReadonlyMap<string, LiveWorldEntry>,
): readonly LiveWorldEntry[] {
  let next: LiveWorldEntry[] | null = null
  for (let index = 0; index < list.length; index += 1) {
    const existing = list[index]
    if (existing === undefined) continue
    const update = updates.get(existing.view.id)
    if (update === undefined || sameContent(existing.view, update.view)) continue
    if (next === null) next = [...list]
    next[index] = { ...update, seq: existing.seq }
  }
  return next ?? list
}

/**
 * The single write path for a batch of `incoming` entries.
 *
 * Posts already known (in `rows` or `pending`) are de-duplicated and have their
 * content refreshed if it changed. Genuinely new posts go to `pending` when
 * `buffer` is true (the controller is reading) and into `rows` otherwise. Pure:
 * returns `state` itself when the batch changes nothing.
 */
export function ingest(
  state: LiveWorldState,
  incoming: readonly LiveWorldEntry[],
  buffer: boolean,
): LiveWorldState {
  if (incoming.length === 0) return state

  const known = new Set<string>()
  for (const entry of state.rows) known.add(entry.view.id)
  for (const entry of state.pending) known.add(entry.view.id)

  const fresh: LiveWorldEntry[] = []
  const refreshes = new Map<string, LiveWorldEntry>()
  const seenInBatch = new Set<string>()
  for (const entry of incoming) {
    const id = entry.view.id
    if (seenInBatch.has(id)) continue
    seenInBatch.add(id)
    if (known.has(id)) refreshes.set(id, entry)
    else fresh.push(entry)
  }

  let rows = refreshes.size > 0 ? refreshContent(state.rows, refreshes) : state.rows
  let pending = refreshes.size > 0 ? refreshContent(state.pending, refreshes) : state.pending
  if (fresh.length > 0) {
    if (buffer) pending = mergeSorted(pending, fresh, MAX_PENDING)
    else rows = mergeSorted(rows, fresh, MAX_ROWS)
  }

  return rows === state.rows && pending === state.pending ? state : { rows, pending }
}

/** Moves every pending arrival into `rows` (the "N new" action). A no-op when none. */
export function mergePending(state: LiveWorldState): LiveWorldState {
  if (state.pending.length === 0) return state
  return { rows: mergeSorted(state.rows, state.pending, MAX_ROWS), pending: [] }
}

// -----------------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------------

/** True when `entry` passes `filter`. */
export function matchesFilter(entry: LiveWorldEntry, filter: LiveWorldFilter): boolean {
  switch (filter.kind) {
    case 'hashtag':
      return entry.tags.includes(filter.tag)
    case 'persona':
      return entry.view.authorPersonaId === filter.personaId
    case 'all':
    default:
      return true
  }
}

const TAG_PREFIX = 'tag:'
const PERSONA_PREFIX = 'persona:'

/** The `<select>` value for a filter (`all`, `tag:<tag>`, `persona:<id>`). */
export function encodeFilter(filter: LiveWorldFilter): string {
  switch (filter.kind) {
    case 'hashtag':
      return `${TAG_PREFIX}${filter.tag}`
    case 'persona':
      return `${PERSONA_PREFIX}${filter.personaId}`
    case 'all':
    default:
      return 'all'
  }
}

/** Inverse of {@link encodeFilter}; anything unrecognised is "all" (never a hidden filter). */
export function decodeFilter(value: string): LiveWorldFilter {
  if (value.startsWith(TAG_PREFIX) && value.length > TAG_PREFIX.length) {
    return { kind: 'hashtag', tag: value.slice(TAG_PREFIX.length) }
  }
  if (value.startsWith(PERSONA_PREFIX) && value.length > PERSONA_PREFIX.length) {
    return { kind: 'persona', personaId: value.slice(PERSONA_PREFIX.length) }
  }
  return ALL_POSTS_FILTER
}

/**
 * The hashtags offered by the filter picker: the {@link MAX_TAG_OPTIONS} most-used
 * tags across `entries`, listed ALPHABETICALLY. Alphabetical (not by usage) so the
 * options don't reshuffle under the controller while they are choosing — usage
 * only decides which tags make the cut. The picker offers only tags actually seen.
 */
export function collectTags(entries: readonly LiveWorldEntry[]): string[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAG_OPTIONS)
    .map(([tag]) => tag)
    .sort((a, b) => a.localeCompare(b))
}

// -----------------------------------------------------------------------------
// Projections
// -----------------------------------------------------------------------------

/** A handle without its leading `@` (the wire and `Persona.handle` omit it; be tolerant). */
function bareHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle
}

/**
 * A short, human-checkable form of a persona id for the UNKNOWN AUTHOR label: the
 * first 8 characters, after dropping the mock cast's `persona-` prefix (which
 * would otherwise be all an 8-character cut showed). A live id is a GUID, so its
 * first 8 characters are already distinctive.
 */
export function shortAuthorId(personaId: string): string {
  return personaId.replace(/^persona-/, '').slice(0, 8)
}

/** The staff label for a post whose author is not in the persona directory. */
export function unknownAuthorLabel(personaId: string): string {
  return `UNKNOWN AUTHOR · ${shortAuthorId(personaId)}`
}

/**
 * Joins a post view with its author into the flat staff-side {@link LiveWorldPost}.
 *
 * A controller must see EVERY post: when `author` is `undefined` (the persona
 * directory has not caught up with the post, or the author was removed) the post
 * is still projected, labelled "UNKNOWN AUTHOR · <short id>" with `authorUnknown`
 * set and a placeholder handle `unknown-<short id>` — never dropped.
 */
export function toLiveWorldPost(
  view: ParticipantPostView,
  author: Persona | undefined,
): LiveWorldPost {
  const identity = author !== undefined
    ? {
      authorPersonaId: author.id,
      authorHandle: bareHandle(author.handle),
      authorDisplayName: author.displayName,
      authorVerified: author.verified,
    }
    : {
      authorPersonaId: view.authorPersonaId,
      authorHandle: `unknown-${shortAuthorId(view.authorPersonaId)}`,
      authorDisplayName: unknownAuthorLabel(view.authorPersonaId),
      authorVerified: false,
      authorUnknown: true as const,
    }
  return {
    id: view.id,
    ...identity,
    text: view.text,
    scenarioTime: view.scenarioTime,
    counts: view.counts,
    ...(view.media != null && view.media.length > 0 ? { media: view.media } : {}),
    ...(view.inReplyTo != null ? { inReplyTo: view.inReplyTo } : {}),
  }
}

/**
 * `text` collapsed to one line and cut to at most {@link REPLY_EXCERPT_MAX}
 * UTF-16 units, ending in an ellipsis when cut. Never splits a surrogate pair.
 */
export function excerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= REPLY_EXCERPT_MAX) return collapsed
  let cut = collapsed.slice(0, REPLY_EXCERPT_MAX - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/** The mono label for an attachment: "IMAGE", "VIDEO", or "VIDEO 0:24". */
export function mediaLabel(item: PostMedia): string {
  if (item.kind === 'image') return 'IMAGE'
  return item.durationSec !== undefined ? `VIDEO ${formatDuration(item.durationSec)}` : 'VIDEO'
}

/** The `ReplyTarget` the "Reply as…" action hands to the composer. */
export function toReplyTarget(post: LiveWorldPost): ReplyTarget {
  return {
    postId: post.id,
    authorHandle: post.authorHandle,
    authorDisplayName: post.authorDisplayName,
    excerpt: excerptOf(post.text),
  }
}
