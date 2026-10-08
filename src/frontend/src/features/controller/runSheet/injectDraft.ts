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
  | { kind: 'scripted'; injectPostId: string }
  | { kind: 'postId'; postId: string }

export interface DraftPost {
  /** Stable React key (the list is reorderable). */
  key: string
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
  const reply: DraftReply = !post.replyTo
    ? { kind: 'none' }
    : 'injectPostId' in post.replyTo
      ? { kind: 'scripted', injectPostId: post.replyTo.injectPostId }
      : { kind: 'postId', postId: post.replyTo.postId }
  const baseline = post.engagementBaseline
  return {
    key: nextKey(),
    personaId: post.personaId,
    text: post.text,
    media: (post.media ?? []).map(m => ({ mediaId: m.mediaId, alt: m.alt })),
    reply,
    baselineOn: baseline !== undefined,
    baselineLike: baseline?.like !== undefined ? String(baseline.like) : '',
    baselineRepost: baseline?.repost !== undefined ? String(baseline.repost) : '',
    baselineReply: baseline?.reply !== undefined ? String(baseline.reply) : '',
  }
}

/** Seeds the form from a server item (edit / read-only view). */
export function draftFromItem(item: InjectItemDto): Draft {
  const posts = item.posts.length > 0 ? item.posts.map(postFromDto) : [blankPost()]
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

function postToWrite(post: DraftPost): InjectPostWrite {
  const write: InjectPostWrite = { personaId: post.personaId, text: post.text }

  if (post.media.length > 0) {
    write.media = post.media.map(m => ({ mediaId: m.mediaId.trim(), alt: m.alt }))
  }

  if (post.reply.kind === 'scripted') write.replyTo = { injectPostId: post.reply.injectPostId }
  else if (post.reply.kind === 'postId') write.replyTo = { postId: post.reply.postId.trim() }

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
  const posts = (draft.kind === 'post' ? draft.posts.slice(0, 1) : draft.posts).map(postToWrite)
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
