/**
 * features/social/pinned/types.ts
 * ---------------------------------------------------------------------------
 * The Pinned tab's wire shapes (demo-feedback story 07, DF-5/DF-6/DF-7), exactly as
 * frozen in `docs/features/demo-feedback/implementation.md` and served by
 * `GET /api/feed/pinned` (`PinWireDtos.cs`, story 04). Pure types, participant world.
 *
 *  - `reason` says why a post is on the tab: a controller pinned it for everyone
 *    (`exercise`), the viewer pinned it (`pin`), or the viewer liked it (`like`). When a
 *    post qualifies for more than one the server keeps the strongest
 *    (`exercise` > `pin` > `like`) and lists the post once.
 *  - `post` is the SAME participant-safe projection the feed uses (XC-002): no
 *    provenance, never who pinned it.
 *
 * The items arrive in DF-5 display order (exercise pins first, newest pin first; then the
 * viewer's pins and likes merged, newest first). The client never re-sorts them.
 */

import type { ParticipantPostView } from '../types/post'

/** Why a post is on the Pinned tab (DF-5). */
export type PinnedFeedReason = 'exercise' | 'pin' | 'like'

/** One Pinned tab entry. */
export interface PinnedFeedItem {
  readonly reason: PinnedFeedReason
  readonly post: ParticipantPostView
}

/** `GET /api/feed/pinned` - the items in DF-5 order, each post at most once, at most 200. */
export interface PinnedFeedResponse {
  readonly items: PinnedFeedItem[]
}
