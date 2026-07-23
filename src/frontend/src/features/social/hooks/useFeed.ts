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
 * FROZEN READING STREAM (feeds-discovery/04, SOC-083; supersedes the interim
 * /07 auto-insert). The hook resolves the baseline ONCE — the current
 * `postStore` snapshot at resolve time — and then FREEZES it: it does NOT
 * subscribe to subsequent store changes, so a post appended after mount never
 * moves, reorders, or slides into the rows the reader is looking at. That is
 * the deliberate D1-005 decision: real-time arrivals BUFFER behind the "▲ N new
 * posts" pill (`useFeedStream` + `<NewPostsPill>`, wired in `<Feed>`) and enter
 * the stream only when the reader taps the pill — the reader's scroll position
 * is never touched for them (AC1/AC2). This hook owns ONLY the frozen baseline;
 * the pill layer owns everything that arrives afterwards.
 *
 * (A post that lands in the store BEFORE this resolve settles is part of the
 * initial baseline — the resolve reads the current snapshot, not a stale one —
 * which is correct: that is the feed the reader first sees, established once.)
 *
 * XC-002 is unchanged: `assembleFeedView`/`toParticipantView` stay the sole
 * narrowing, so the baseline's provenance is stripped on read.
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
        // Freeze the baseline from the store's CURRENT snapshot at resolve time.
        // `resolveFeed()` is awaited for its validation + fail-closed/loading
        // semantics; the store (which its mock adapter reads) is the source of
        // truth for the rows. There is intentionally NO store subscription:
        // posts appended AFTER this are the pill's to buffer (feeds-discovery/04),
        // never this hook's to insert — the reading stream stays frozen.
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

    return () => {
      cancelled = true
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
