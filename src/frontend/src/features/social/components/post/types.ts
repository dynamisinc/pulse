/**
 * features/social/components/post/types.ts
 * ---------------------------------------------------------------------------
 * The presentational types of the decomposed `<PostCard>` (demo-polish F0,
 * implementation.md §1.11 / §4.3). FROZEN after F0: later stories ask the
 * orchestrator for a change here, they do not edit it.
 *
 * `PostView` is the PARTICIPANT-SAFE view `<PostCard>` renders. Deliberately
 * narrow: it carries no provenance/origin field (that is staff-only,
 * story 03/R-003) and no editorial-badge field (SOC-002) — there is nothing
 * here for either to leak from. It is assembled by `feedService.toPostView`
 * from a `ParticipantPostView` (XC-002) plus the resolved author persona.
 *
 * The wire-level members come straight from the contract-v2 types in
 * `../../types/post.ts` (`PostMedia` v2, `PostInReplyTo`, `PostViewerState`,
 * `PostLinkPreview`, `PostCounts`) — they are re-exported here under the
 * historical names (`PostMediaView`, `PostLinkPreviewView`) so every existing
 * `@/features/social` import keeps resolving.
 *
 * Participant world: pure types, no UI, no COBRA.
 */

import type { Persona } from '@/features/personas'
import type {
  PostCounts,
  PostEditedSummary,
  PostInReplyTo,
  PostLinkPreview,
  PostMedia,
  PostViewerState,
} from '../../types/post'

export type { PostCounts }

/** A single media attachment (contract v2: id, kind image|video, url, alt, …). */
export type PostMediaView = PostMedia

/** An in-sim link preview card. */
export type PostLinkPreviewView = PostLinkPreview

/** The two render modes a shell variant maps to (COR-015 / D1-011). */
export type PostCardVariant = 'full' | 'readOnly'

/**
 * The participant-safe post view `<PostCard>` renders. See the module header.
 */
export interface PostView {
  id: string
  author: Persona
  text: string
  media?: PostMedia[]
  /** Set for a reply: the parent post and its author's handle (no leading '@'). */
  inReplyTo?: PostInReplyTo
  linkPreview?: PostLinkPreview
  counts: PostCounts
  /** The caller's own like/repost state; absent when unknown (broadcasts, staff). */
  viewer?: PostViewerState
  /** Edit summary (DF-31); absent when never edited. */
  edited?: PostEditedSummary
  /**
   * Pinned for everyone by a controller (DF-7): `true` or absent, as the read said. The card
   * shows its "Pinned" marker from this plus the live pin state (story 21). Never says who
   * or when; a personal pin is `viewer.pinned`, never this.
   */
  pinnedForAll?: true
  /** Scenario-time ISO instant this post was published (COR-053). */
  scenarioTime: string
}

export interface PostCardProps {
  post: PostView
  /**
   * `'readOnly'` = observer session (COR-015): controls absent, counts inert. Not the
   * embed mode: a card shown inside another channel uses the `readOnly` PROP below.
   */
  variant?: PostCardVariant
  /**
   * The EMBEDDED read-only card (channels-foundation 21, COR-015): the whole engagement
   * row (reply / repost / like / pin / edit, and the counts with it) is ABSENT from the
   * DOM and the a11y tree, not disabled. What another channel renders when it shows a
   * post inside its own page (the portal stream, a news embed). The author, time, body,
   * media, link card and "Edited" marker are unchanged, and `onOpen` / `onOpenProfile` /
   * `onHashtagOpen` still work when supplied. Omitted (the default): the card renders
   * exactly as before. Omitting the callbacks does NOT make a card read-only, and the
   * observer `variant="readOnly"` is a different mode (it keeps the counts, as inert text).
   */
  readOnly?: boolean
  /** Fires when the card body (header/text/media — not the action row) is activated. */
  onOpen?: (id: string) => void
  /**
   * Fires with the post id when the reply action is activated (click or
   * keyboard). Optional — omit it and the reply button behaves exactly as
   * before (no-op). Never wired when `variant === 'readOnly'` (counts stay
   * inert there).
   */
  onReply?: (id: string) => void
  /**
   * Fires with the normalized tag (no leading `#`) when a linkified hashtag
   * in the post text is activated (SOC-040). Optional — omit it and
   * hashtags render as inert, non-focusable `<span>`s instead of anchors
   * (WR-002, NFR-001): no role/tabIndex/handler, so there is no focusable
   * no-op.
   */
  onHashtagOpen?: (tag: string) => void
  /**
   * Fires with the AUTHOR's persona id when the author identity (display name
   * + verified mark + handle) is activated (SOC-050). Optional — omit it and
   * the header renders exactly as before: plain text, no overlay button, no
   * focusable no-op (WR-002). See `PostHeader` for why this is a second
   * overlay rather than a `<button>` wrapped around the name.
   */
  onOpenProfile?: (personaId: string) => void
}
