/**
 * features/controller/runSheet/injectDraft.ts
 * ---------------------------------------------------------------------------
 * The EDITOR'S form model and its conversion to/from the wire (`InjectItemWrite`)
 * — inject-queue story 07, AC "Author live". STAFF world, no UI, no React.
 *
 * WHY A SEPARATE DRAFT. A form must be able to hold what a wire object cannot: a
 * half-typed number ("1" on the way to "15"), a blank assignee, a baseline the
 * controller has switched on but not filled in, a reply mode with no target yet.
 * So numbers live as STRINGS here, and `draftToWrite` parses them and runs the
 * shared `validateWrite` (the client mirror of story 06's validation matrix) to
 * produce `{ write, errors }`. Errors are keyed by dotted field path
 * (`title`, `posts.1.text`, `posts.0.media.0.alt`, ...), the same keys the server's
 * 400 is normalised to, so a client error and a server error land on the same field.
 *
 * MODES. In `post` mode only the FIRST post is submitted, but the other posts are
 * KEPT in the draft so toggling post -> burst -> post never throws away typed text.
 * Burst posts keep their order (the up/down buttons) — order IS the release order.
 *
 * CHILD IDENTITY + SIBLING REPLIES (contract amendment, implementation.md "Child identity
 * on PUT"). A draft post that came from the server carries its `id`, and `draftToWrite`
 * echoes it on PUT so the child keeps its identity (status, fired post, replies pointing
 * at it); a post added in the editor has no `id` (new child). A reply to an EARLIER post of
 * the SAME item is held here by the target's stable draft `key` (kind `sibling`), not by
 * an id or a position: ids do not exist yet for a new burst, and positions change when
 * posts are reordered or removed. `draftToWrite` turns it into `{ sequence }` (the
 * target's current 1-based position) at submit time, so the reference is always correct
 * for the order being saved — including at CREATE. `normalizeSiblingReplies` runs after a
 * reorder/remove and CLEARS a reference whose target was deleted or now comes after the
 * reply (a reply to a later post is meaningless), leaving an inline `replyNotice`.
 *
 * SANITISATION (NFR-004). The text is submitted as typed; the server sanitises it at
 * fire through the one ingest funnel. The console never renders it as HTML (React
 * text only), so there is nothing to strip here.
 */

import { INJECT_LIMITS, validateWrite } from './injectRules'
import type {
  InjectItemDto,
  InjectItemWrite,
  InjectKind,
  InjectPostDto,
  InjectPostWrite,
} from './types'

export interface DraftMedia {
  mediaId: string
  alt: string
}

export type DraftReply =
  | { kind: 'none' }
  /** An EARLIER post of this same item, by that draft post's stable `key`. */
  | { kind: 'sibling'; key: string }
  /** A post in another item (`replyTo.injectPostId`). */
  | { kind: 'scripted'; injectPostId: string }
  /** An existing post, by pasted id (`replyTo.postId`). */
  | { kind: 'postId'; postId: string }

export interface DraftPost {
  /** Stable React key + sibling-reply target (the list is reorderable). */
  key: string
  /** The server child's id (edit only), echoed on PUT to keep its identity. Absent = new. */
  id?: string
  /** The child already fired: it is immutable, so the editor locks it. */
  fired?: boolean
  /** Inline note when a reorder/remove had to clear this post's sibling reply. */
  replyNotice?: string
  personaId: string
  text: string
  media: DraftMedia[]
  reply: DraftReply
  baselineOn: boolean
  baselineLike: string
  baselineRepost: string
  baselineReply: string
}

export interface Draft {
  kind: InjectKind
  title: string
  notes: string
  /** `''` = no planned minute. */
  plannedMinute: string
  /** `''` = unassigned. */
  assigneeId: string
  /** `''` = the server default (90). */
  windowSeconds: string
  posts: DraftPost[]
}

let keyCounter = 0
const nextKey = (): string => `draft-post-${++keyCounter}`

export function blankPost(): DraftPost {
  return {
    key: nextKey(),
    personaId: '',
    text: '',
    media: [],
    reply: { kind: 'none' },
    baselineOn: false,
    baselineLike: '',
    baselineRepost: '',
    baselineReply: '',
  }
}

/** A new item: a single empty post, assigned to `assigneeId` (default: the caller). */
export function blankDraft(assigneeId = ''): Draft {
  return {
    kind: 'post',
    title: '',
    notes: '',
    plannedMinute: '',
    assigneeId,
    windowSeconds: String(INJECT_LIMITS.windowDefault),
    posts: [blankPost()],
  }
}

function postFromDto(post: InjectPostDto): DraftPost {
  const baseline = post.engagementBaseline
  return {
    key: nextKey(),
    id: post.id,
    fired: post.status === 'fired',
    personaId: post.personaId,
    text: post.text,
    media: (post.media ?? []).map(m => ({ mediaId: m.mediaId, alt: m.alt })),
    reply: { kind: 'none' },
    baselineOn: baseline !== undefined,
    baselineLike: baseline?.like !== undefined ? String(baseline.like) : '',
    baselineRepost: baseline?.repost !== undefined ? String(baseline.repost) : '',
    baselineReply: baseline?.reply !== undefined ? String(baseline.reply) : '',
  }
}

/** Seeds the form from a server item (edit / read-only view). */
export function draftFromItem(item: InjectItemDto): Draft {
  const posts = item.posts.length > 0 ? item.posts.map(postFromDto) : [blankPost()]
  // Replies are resolved in a second pass: a sibling target is a DRAFT key, which exists
  // only once every post has been built. The server may echo a sibling reply as
  // `{ sequence }` or as `{ injectPostId }` of that sibling; both become a sibling reply.
  item.posts.forEach((dto, index) => {
    const draftPost = posts[index]
    const reply = dto.replyTo
    if (!draftPost || !reply) return
    if ('postId' in reply) {
      draftPost.reply = { kind: 'postId', postId: reply.postId }
    } else if ('sequence' in reply) {
      const target = posts[reply.sequence - 1]
      draftPost.reply =
        target && reply.sequence - 1 < index
          ? { kind: 'sibling', key: target.key }
          : { kind: 'none' }
    } else {
      const at = item.posts.findIndex(candidate => candidate.id === reply.injectPostId)
      const target = at >= 0 && at < index ? posts[at] : undefined
      draftPost.reply = target
        ? { kind: 'sibling', key: target.key }
        : { kind: 'scripted', injectPostId: reply.injectPostId }
    }
  })
  return {
    kind: item.kind,
    title: item.title,
    notes: item.notes ?? '',
    plannedMinute: item.plannedMinute !== undefined ? String(item.plannedMinute) : '',
    assigneeId: item.assigneeId ?? '',
    windowSeconds:
      item.burstWindowSeconds !== undefined
        ? String(item.burstWindowSeconds)
        : String(INJECT_LIMITS.windowDefault),
    posts,
  }
}

/** `''` -> undefined; otherwise a number (NaN when it is not numeric — validation flags it). */
const parseOptionalNumber = (text: string): number | undefined =>
  text.trim() === '' ? undefined : Number(text)

/**
 * `siblings` is the ordered list of posts being submitted: a sibling reply becomes the
 * target's current 1-based position in it (`{ sequence }`), or a flagged error value
 * (0) when the target is missing or not earlier — which `validateWrite` then refuses.
 */
function postToWrite(
  post: DraftPost,
  index: number,
  siblings: readonly DraftPost[],
): InjectPostWrite {
  const write: InjectPostWrite = { personaId: post.personaId, text: post.text }
  if (post.id !== undefined) write.id = post.id

  if (post.media.length > 0) {
    write.media = post.media.map(m => ({ mediaId: m.mediaId.trim(), alt: m.alt }))
  }

  if (post.reply.kind === 'sibling') {
    const target = post.reply.key
    const at = siblings.findIndex(candidate => candidate.key === target)
    write.replyTo = { sequence: at >= 0 && at < index ? at + 1 : 0 }
  } else if (post.reply.kind === 'scripted') {
    write.replyTo = { injectPostId: post.reply.injectPostId }
  } else if (post.reply.kind === 'postId') {
    write.replyTo = { postId: post.reply.postId.trim() }
  }

  if (post.baselineOn) {
    const baseline: NonNullable<InjectPostWrite['engagementBaseline']> = {}
    const like = parseOptionalNumber(post.baselineLike)
    const repost = parseOptionalNumber(post.baselineRepost)
    const reply = parseOptionalNumber(post.baselineReply)
    if (like !== undefined) baseline.like = like
    if (repost !== undefined) baseline.repost = repost
    if (reply !== undefined) baseline.reply = reply
    if (Object.keys(baseline).length > 0) write.engagementBaseline = baseline
  }
  return write
}

export interface DraftResult {
  readonly write: InjectItemWrite
  /** Dotted field path -> message. Empty means the draft is valid to submit. */
  readonly errors: Readonly<Record<string, string>>
}

/** Builds the wire write from the form and validates it against the authoring limits. */
export function draftToWrite(draft: Draft): DraftResult {
  const submitted = draft.kind === 'post' ? draft.posts.slice(0, 1) : draft.posts
  const posts = submitted.map((post, index) => postToWrite(post, index, submitted))
  const write: InjectItemWrite = { kind: draft.kind, title: draft.title.trim(), posts }

  if (draft.notes.trim() !== '') write.notes = draft.notes
  const planned = parseOptionalNumber(draft.plannedMinute)
  if (planned !== undefined) write.plannedMinute = planned
  write.assigneeId = draft.assigneeId === '' ? null : draft.assigneeId
  if (draft.kind === 'burst') {
    const window = parseOptionalNumber(draft.windowSeconds)
    if (window !== undefined) write.burstWindowSeconds = window
  }

  return { write, errors: validateWrite(write) }
}

export const REPLY_TARGET_REMOVED = 'The post this replied to was removed, so the reply was cleared.'
export const REPLY_TARGET_NOW_LATER =
  'The post this replied to now comes after it, so the reply was cleared.'

/**
 * Keeps sibling replies truthful after posts were reordered or removed. A reply holds its
 * target by stable draft key, so a target that merely MOVED (and is still earlier) stays
 * correctly pointed — its `{ sequence }` is recomputed at submit time. Two cases cannot be
 * kept and are CLEARED, each with an inline `replyNotice` saying why:
 *   - the target was removed from the burst;
 *   - the target now comes at or after the reply (a reply to a later post is meaningless).
 * Unchanged posts keep their object identity (the editor memoises on it).
 */
export function normalizeSiblingReplies(posts: readonly DraftPost[]): DraftPost[] {
  return posts.map((post, index) => {
    if (post.reply.kind !== 'sibling') return post
    const target = post.reply.key
    const at = posts.findIndex(candidate => candidate.key === target)
    if (at >= 0 && at < index) return post
    return {
      ...post,
      reply: { kind: 'none' },
      replyNotice: at < 0 ? REPLY_TARGET_REMOVED : REPLY_TARGET_NOW_LATER,
    }
  })
}
