/**
 * features/social/hooks/useRecentPublicPosts.ts
 * ---------------------------------------------------------------------------
 * The newest few public posts, for channels that show a slice of Social inside their
 * own page (channels-foundation 21, portal R-S1: the portal's Social Stream module and
 * the kiosk feed slide). Participant world; a pure data hook, no UI.
 *
 * WHAT IT RETURNS. The newest `limit` (1-20, default 5) top-level, public, visible posts
 * of the session's exercise, newest first by scenario time (COR-053), as
 * participant-safe `ParticipantPostView`s (XC-002). Excluded: replies (`inReplyTo`),
 * tombstones and soft-deleted posts (`isVisiblePost`, plus a `'hidden'` marker should one
 * ever arrive), and anything a controller took down (the store drops it). The server's
 * feed read is already top-level and visible-only, and the arrival source is top-level
 * only; this filter is the hook's own guarantee on top of both, since an arrival is held
 * as delivered and may carry a removal marker. Social has no direct messages on the feed
 * read, so none can appear. There is no future-dated filter (unlike Trending's tolerance):
 * a post reaches the feed only once published, stamped by the server's exercise clock, so a
 * pre-staged inject is not in the baseline before it fires.
 *
 * NO SECOND READ OR CONNECTION. It reads the SHARED Explore baseline
 * (`useExploreBaseline`): the one ref-counted feed read and arrival subscription that
 * Trending and search already use. Mounting it beside them opens nothing new. An observer
 * / read-only mount gets the baseline read and no arrival stream (D1-011), as Trending does.
 *
 * BURST (NFR-002/SOC-071). The store publishes arrivals in batches
 * (`EXPLORE_ARRIVAL_BATCH_MS`, 250 ms), so a 120-posts/min burst re-renders a consumer at
 * most once per batch, which is well under once per animation frame. The slice is
 * memoized on the batch, so it keeps its identity between batches.
 *
 * ISOLATION (XC-001). It takes no exercise id and puts none on the wire: the read is
 * session-scoped server-side and the store is keyed by the session's exercise + account,
 * so another session's posts are never returned.
 */

import { useMemo } from 'react'
import type { ParticipantPostView } from '../types/post'
import { exploreFeedStore, type ExploreFeedStore } from '../explore/exploreFeedStore'
import { useExploreBaseline } from '../explore/useExploreFeed'
import { isVisiblePost } from '../explore/visibility'

/** The default slice size. */
export const RECENT_PUBLIC_POSTS_DEFAULT_LIMIT = 5
/** The largest slice served (no pagination beyond it). */
export const RECENT_PUBLIC_POSTS_MAX_LIMIT = 20

export interface UseRecentPublicPostsOptions {
  /** How many posts, 1-20 (clamped; default 5). */
  readonly limit?: number
}

export interface UseRecentPublicPostsResult {
  /** Newest first, at most `limit`. Stable identity between store batches. */
  readonly posts: readonly ParticipantPostView[]
  /** True until the shared baseline read has settled. */
  readonly loading: boolean
  /** The baseline read failed (the store is retrying). */
  readonly failed: boolean
}

/** Clamps `limit` to 1-20; a missing or non-finite value is the default. */
export function clampRecentLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return RECENT_PUBLIC_POSTS_DEFAULT_LIMIT
  return Math.min(RECENT_PUBLIC_POSTS_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

/** A top-level, visible post (see the module header). */
function isPublicTopLevel(post: ParticipantPostView): boolean {
  if (post.inReplyTo !== undefined) return false
  if (!isVisiblePost(post)) return false
  const status: unknown = 'status' in post ? post.status : undefined
  return status !== 'hidden'
}

/**
 * The newest public posts of the session's exercise. See the module header.
 * `store` is injectable for tests only; product code uses the shared one.
 */
export function useRecentPublicPosts(
  options: UseRecentPublicPostsOptions = {},
  store: ExploreFeedStore = exploreFeedStore,
): UseRecentPublicPostsResult {
  const limit = clampRecentLimit(options.limit)
  const { posts, loading, failed } = useExploreBaseline(store)

  const slice = useMemo(() => {
    const next: ParticipantPostView[] = []
    for (const post of posts) {
      if (next.length >= limit) break
      if (isPublicTopLevel(post)) next.push(post)
    }
    return next
  }, [posts, limit])

  return { posts: slice, loading, failed }
}
