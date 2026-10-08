/**
 * features/social/explore/visibility.ts
 * ---------------------------------------------------------------------------
 * "Does this post count?" for Explore's derived views (demo-polish F6; trending and
 * search). A pure, UI-free participant-world module.
 *
 * The loaded feed is normally already free of soft-deleted posts (the server's feed
 * read returns visible posts only; a taken-down reply is only ever a thread
 * TOMBSTONE). A derived view must still never be what resurrects a removed post — a
 * taken-down post that kept its hashtag would keep inflating a trend or turning up in
 * search — so both filter through this predicate regardless of what the read did.
 *
 * The contract's tombstone marker is `status: 'taken-down'` (implementation.md
 * §1.5.3, `hooks/useThread.ts`); `'deleted'` is accepted too so another wire name for
 * the same idea cannot silently start counting. A post with NO status (every ordinary
 * `PostView`, which has no such field) is visible.
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
