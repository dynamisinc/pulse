/**
 * features/social/hooks/useFeed.ts
 * ---------------------------------------------------------------------------
 * The All Posts feed data hook (feature: feeds-discovery, story 01; SOC-080,
 * COR-001, COR-053, XC-002, NFR-002/003). Participant world (Pulse Social
 * skin) — no UI, no COBRA.
 *
 * Orchestrates the two reads the feed needs and runs them through the story's
 * convergence (`assembleFeedView`, in `../services/feedService`):
 *
 *   1. `resolveFeed()`  — the swappable post read seam (mock now, live `/feed`
 *      later). Wrapped in a thin `useState`/`useEffect` loader mirroring
 *      `usePersonas` (ordinary cacheable data; a later refactor may lift both
 *      onto React Query, the project default).
 *   2. `usePersonas()`  — the participant-safe cast read path. NEVER
 *      `personaById`/`SEEDED_PERSONAS` (mock-only, fail-open — banned on a
 *      shipped participant surface).
 *
 * LIVE UPDATES (feeds-discovery/07, SOC-083 partial). The hook resolves the
 * baseline ONCE, then subscribes to the module-singleton `postStore` (the same
 * store `resolveFeed`'s mock adapter reads). When a post is appended (e.g. a
 * controller publishing as a persona, wired at integration — not here), the
 * subscription re-reads `postStore.getPosts()` into `rawPosts` and the memoized
 * `assembleFeedView` re-derives, so the new post appears at the TOP
 * (newest-first, by `scenarioTime`) WITHOUT a full remount or a re-fetch of the
 * seeded baseline. This is the deliberately minimal slice — NO "new posts"
 * pill, NO auto-scroll, NO mid-stream slide-in (all the FULL follow-up #123);
 * the arrival is announced only by `<Feed>`'s existing `aria-live="polite"`
 * region (NFR-001). XC-002 is unchanged: `assembleFeedView`/`toParticipantView`
 * stay the sole narrowing, so a just-appended post's provenance is stripped on
 * read exactly like a seeded one.
 *
 * The mapped `PostView[]` is memoized on `{posts, personas}`, so the array AND
 * each row object keep a STABLE identity across re-renders that don't change
 * either input (e.g. the feed-view telemetry effect, or a future new-post
 * arrival elsewhere). That stability is what lets the memoized feed row skip
 * re-rendering under burst (NFR-002/SOC-071) and lets a windowing layer drop in
 * later without reshaping this flow.
 *
 * ISOLATION (COR-001): neither read takes a client `exerciseId` — the session
 * binds the exercise, query scoping is server-side.
 */

import { useEffect, useMemo, useState } from 'react'
import { usePersonas } from '@/features/personas'
import type { PostView, Post } from '@/features/social'
import { resolveFeed, assembleFeedView } from '../services/feedService'
import { postStore } from '../services/postStore'

export interface UseFeedResult {
  /** The exercise's public posts, newest-first, as participant-safe views. */
  readonly posts: readonly PostView[]
  /** True until BOTH the posts and the persona cast have resolved. */
  readonly loading: boolean
  /** First error from either read, or `undefined`. */
  readonly error: unknown
}

/**
 * Resolves the All Posts feed for a component: raw posts + the persona cast,
 * converged into the `PostView[]` `<Feed>` renders. See the module header.
 */
export function useFeed(): UseFeedResult {
  const [rawPosts, setRawPosts] = useState<readonly Post[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsError, setPostsError] = useState<unknown>(undefined)

  const { personas, loading: personasLoading, error: personasError } = usePersonas()

  useEffect(() => {
    let cancelled = false
    setPostsLoading(true)
    resolveFeed()
      .then(() => {
        if (cancelled) return
        // Set from the store's CURRENT snapshot, NOT the value captured when the
        // request started: an append that lands while this baseline resolve is
        // in flight has already updated the store (and fired the subscription
        // below), so reading the stale `resolved` here would clobber the
        // just-appended post until the next append. `resolveFeed()` is still
        // awaited for its validation + fail-closed/loading semantics; the store
        // (which its mock adapter reads) is the single source of truth for the
        // rows, read the same way as the subscription.
        setRawPosts(postStore.getPosts())
        setPostsError(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPostsError(err)
      })
      .finally(() => {
        if (!cancelled) setPostsLoading(false)
      })

    // Live seam (feeds-discovery/07): re-read the store on every append so a new
    // post surfaces without a re-fetch — the same current-snapshot read as the
    // resolve path above, so neither can clobber the other regardless of order.
    const unsubscribe = postStore.subscribe(() => {
      if (cancelled) return
      setRawPosts(postStore.getPosts())
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const posts = useMemo(
    () => assembleFeedView(rawPosts, personas),
    [rawPosts, personas],
  )

  return {
    posts,
    loading: postsLoading || personasLoading,
    error: postsError ?? personasError,
  }
}
