/**
 * features/social/explore/visibility.ts
 * ---------------------------------------------------------------------------
 * The one definition of "does this post count?" for Explore's derived views
 * (trending and search; demo-polish F6, SOC-041/SOC-042). Participant world —
 * a pure, UI-free module.
 *
 * WHY THIS EXISTS. Trending and search are both COMPUTED CLIENT-SIDE over the
 * loaded newest-200 feed. That feed is normally already free of soft-deleted
 * posts (the server's feed read returns visible posts only, and the mock feed
 * does the same — a taken-down reply is only ever a thread TOMBSTONE). But a
 * derived view must never be the thing that resurrects a removed post: a
 * taken-down post that still carried a hashtag would otherwise keep inflating a
 * trend, or keep turning up in search results, after a controller removed it. So
 * both derivations filter through this predicate, defensively, regardless of
 * what the read above them did.
 *
 * VOCABULARY. The contract's tombstone marker is `status: 'taken-down'`
 * (implementation.md §1.5.3, `hooks/useThread.ts`); `'deleted'` is accepted too
 * so a future wire name for the same idea cannot silently start counting. A post
 * with NO status (every ordinary `PostView`, which has no such field at all) is
 * visible.
 */

/** A structural slice: anything that may carry the contract's removal marker. */
export interface VisibilityMarked {
  /** `'taken-down'` (the contract's tombstone) or `'deleted'` means soft-deleted. */
  readonly status?: string
}

/**
 * True when the post is visible (not soft-deleted / taken down). Takes any
 * object — a `PostView` has no `status` field at all, and an all-optional
 * parameter type would reject it as a "weak type" — and reads the marker only if
 * it is there.
 */
export function isVisiblePost(post: object): boolean {
  const status: unknown = 'status' in post ? post.status : undefined
  return status !== 'taken-down' && status !== 'deleted'
}
