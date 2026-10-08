/**
 * features/social/hooks/useFeedWithReplies.ts
 * ---------------------------------------------------------------------------
 * The "everything, replies included" post read behind the profile page's
 * "Posts & replies" and "Likes" tabs (demo-polish F5, story 14; DP-5).
 *
 * WHY A SEPARATE HOOK. `useFeed()` is the top-level feed and deliberately has no
 * `includeReplies` option (feed, trending and search must stay top-level). The
 * profile needs the superset, so this calls `resolveFeed('all', { includeReplies:
 * true })` directly — the swappable seam (`GET /api/feed?includeReplies=true`
 * live; the `postStore` mock adapter in dev) — and converges it through the same
 * `assembleFeedView` as the feed (XC-002 narrowing, author resolution, newest-
 * first by scenario time). It takes the persona cast from the caller (the profile
 * page already holds `usePersonas()`), so it never triggers a second cast read.
 *
 * LAZY AND FRESH. Nothing is fetched until `active` is true (the participant
 * opened a tab that needs it), so a plain profile view costs no extra request.
 * Every time `active` flips true again the read repeats: the Likes tab reflects
 * a like made on another tab, and the previous list stays on screen while the
 * refetch is in flight (`loading` is true only while there is nothing to show).
 *
 * EXERCISE SCOPE (COR-001): the read takes no client `exerciseId`; the session
 * binds the exercise server-side. Failure is surfaced (`error`), never swapped
 * for an empty or unscoped result.
 *
 * Participant world: a data hook, no UI.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Persona } from '@/features/personas'
import type { Post, PostView } from '@/features/social'
import { assembleFeedView, resolveFeed } from '../services/feedService'

export interface UseFeedWithRepliesResult {
  /** Every visible post, replies included, newest first, as participant-safe views. */
  readonly posts: readonly PostView[]
  /** True while the read is in flight AND there is nothing to show yet. */
  readonly loading: boolean
  /** The last read's error, or `undefined`. */
  readonly error: unknown
}

/**
 * @param active   Fetch (and re-fetch on each false -> true) while true.
 * @param personas The exercise cast, used to resolve each post's author.
 */
export function useFeedWithReplies(
  active: boolean,
  personas: readonly Persona[],
): UseFeedWithRepliesResult {
  const [rawPosts, setRawPosts] = useState<readonly Post[] | undefined>(undefined)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setInFlight(true)
    setError(undefined) // a retry starts clean: no stale error while it runs
    resolveFeed('all', { includeReplies: true })
      .then(posts => {
        if (cancelled) return
        setRawPosts(posts)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setInFlight(false)
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const posts = useMemo(
    () => (rawPosts === undefined ? [] : assembleFeedView(rawPosts, personas)),
    [rawPosts, personas],
  )

  return {
    posts,
    // Before the first response lands (and while a read is running) there is nothing
    // to show. After it, a refetch keeps the previous list visible.
    loading: rawPosts === undefined && error === undefined && (active || inFlight),
    error,
  }
}
