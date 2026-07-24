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
 *   1. `resolveFeed()`  — the swappable post read seam (mock adapter reading
 *      `postStore` today; a live `GET /api/feed` returning `ParticipantPostDto[]`
 *      when `USE_MOCK_DATA` is false — see `feedService.ts`). Wrapped in a
 *      thin `useState`/`useEffect` loader mirroring `usePersonas` (ordinary
 *      cacheable data; a later refactor may lift both onto React Query, the
 *      project default).
 *   2. `usePersonas()`  — the participant-safe cast read path. NEVER
 *      `personaById`/`SEEDED_PERSONAS` (mock-only, fail-open — banned on a
 *      shipped participant surface).
 *
 * THE BASELINE IS WHATEVER `resolveFeed()` RETURNS (UAT fix — the prior build
 * discarded the resolved value and re-read `postStore.getPosts()` instead,
 * which meant a LIVE `/feed` response was silently thrown away and every
 * participant feed rendered the in-memory mock store regardless of what the
 * backend actually persisted). There is no separate "read the store after the
 * fact" step any more: `setRawPosts(posts)` uses the array `resolveFeed()`
 * resolved with, so this works identically in both modes — mock mode's
 * adapter happens to source that array from `postStore.getPosts()`; live
 * mode's response comes straight off the wire. Consumers of this hook never
 * need to know which.
 *
 * FROZEN READING STREAM (feeds-discovery/04, SOC-083; supersedes the interim
 * /07 auto-insert). The hook resolves the baseline ONCE and then FREEZES it:
 * it does NOT subscribe to `postStore` (or anything else) after that, so a
 * post appended/arriving after mount never moves, reorders, or slides into the
 * rows the reader is looking at. That is the deliberate D1-005 decision:
 * real-time arrivals BUFFER behind the "▲ N new posts" pill (`useFeedStream` +
 * `<NewPostsPill>`, wired in `<Feed>`, sourced from the shared SignalR
 * `PostReceived` push in live mode) and enter the stream only when the reader
 * taps the pill — the reader's scroll position is never touched for them
 * (AC1/AC2). This hook owns ONLY the frozen baseline; the pill layer owns
 * everything that arrives afterwards.
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
      .then(posts => {
        if (cancelled) return
        // Freeze the baseline at exactly what `resolveFeed()` resolved with —
        // the mock adapter's `postStore` snapshot in mock mode, the live
        // `GET /api/feed` response in live mode. There is intentionally NO
        // separate re-read of any store and NO subscription: posts that arrive
        // AFTER this are the pill's to buffer (feeds-discovery/04), never this
        // hook's to insert — the reading stream stays frozen.
        setRawPosts(posts)
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
