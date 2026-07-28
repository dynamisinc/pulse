/**
 * features/social/hooks/useFeed.ts
 * ---------------------------------------------------------------------------
 * The All Posts / Following feed data hook (feature: feeds-discovery, story 01
 * "All Posts" + story 02 "Following"; SOC-080, SOC-081, COR-001, COR-053,
 * XC-002, NFR-002/003). Participant world (Pulse Social skin) — no UI, no
 * COBRA.
 *
 * Orchestrates the two reads the feed needs and runs them through the story's
 * convergence (`assembleFeedView`, in `../services/feedService`):
 *
 *   1. `resolveFeed(scope)` — the swappable post read seam (mock adapter
 *      reading `postStore` today; a live `GET /api/feed[?scope=following]`
 *      returning `ParticipantPostDto[]` when `USE_MOCK_DATA` is false — see
 *      `feedService.ts`). Wrapped in a thin `useState`/`useEffect` loader
 *      mirroring `usePersonas` (ordinary cacheable data; a later refactor may
 *      lift both onto React Query, the project default).
 *   2. `usePersonas()`  — the participant-safe cast read path. NEVER
 *      `personaById`/`SEEDED_PERSONAS` (mock-only, fail-open — banned on a
 *      shipped participant surface).
 *
 * SCOPE (story 02, SOC-081): `useFeed(scope)` defaults to `'all'` — every
 * existing call site (`useFeed()`) is unaffected. Passing `'following'` re-runs
 * the same load effect against the SAME seam with a different `scope`, so
 * switching scopes is just a re-fetch, not a second code path.
 *
 * COR-015 IS ENFORCED IN THIS HOOK, NOT ONLY IN THE CALLER (WR-005 fold,
 * Gate-1 #88/#121). An earlier revision left the "read-only/no-persona
 * sessions default to All Posts" guard entirely to `<Feed>` and DOCUMENTED
 * that as making a future integration mistake unable to violate the rule —
 * which wasn't true: this hook is exported from the feature barrel
 * (`features/social/index.ts`), so a future component could call
 * `useFeed('following')` directly, skip `<Feed>` (and its guard) entirely,
 * and serve an observer/no-persona session the empty Following feed. The
 * guard now lives HERE too, reading the session itself — the SAME
 * `!isReadOnly && personaId !== undefined` predicate `<Feed>` and
 * `useReaction`'s `canReact` both use — so `'following'` degrades to `'all'`
 * for such a session regardless of which component asked for it. `<Feed>`
 * still computes its OWN `effectiveScope` for its labeling/telemetry
 * (`feedEntityId`, the empty-state copy) — passing an already-resolved
 * `'all'` through this hook's guard a second time is a no-op, so existing
 * behavior is unchanged; only a caller that bypasses `<Feed>` sees a
 * difference, and the difference is that the rule now actually holds. An
 * empty result for a genuinely-honored `'following'` (no follow edges)
 * resolves as an empty `posts` array with `loading: false, error: undefined`
 * — the honest "nothing to show" state, not a fallback to `'all'`.
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
import { useSession } from '@/core/auth'
import { usePersonas } from '@/features/personas'
import type { PostView, Post } from '@/features/social'
import { resolveFeed, assembleFeedView, type FeedScope } from '../services/feedService'

export interface UseFeedResult {
  /** The exercise's public posts, newest-first, as participant-safe views. */
  readonly posts: readonly PostView[]
  /** True until BOTH the posts and the persona cast have resolved. */
  readonly loading: boolean
  /** First error from either read, or `undefined`. */
  readonly error: unknown
}

/**
 * Resolves a feed for a component: raw posts (for `scope`, default `'all'`) +
 * the persona cast, converged into the `PostView[]` `<Feed>` renders. See the
 * module header — `<Feed>` still decides which scope to REQUEST (and owns the
 * labeling/telemetry that follows from it), but this hook enforces the
 * COR-015 "read-only/no-persona sessions never get 'following'" rule itself
 * too (WR-005 fold), so it cannot be sidestepped by a caller that skips
 * `<Feed>`.
 */
export function useFeed(scope: FeedScope = 'all'): UseFeedResult {
  const [rawPosts, setRawPosts] = useState<readonly Post[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsError, setPostsError] = useState<unknown>(undefined)

  const { personas, loading: personasLoading, error: personasError } = usePersonas()
  const session = useSession()

  // COR-015 (WR-005 fold): the SAME `!isReadOnly && personaId !== undefined`
  // predicate `<Feed>` and `useReaction`'s `canReact` use, applied here too —
  // a read-only/no-persona session's requested `'following'` degrades to
  // `'all'` regardless of which component asked. Re-applying it to an
  // ALREADY-resolved `'all'` (the normal `<Feed>` call path) is a no-op.
  const canUseFollowing = !session.isReadOnly && session.personaId !== undefined
  const effectiveScope: FeedScope = scope === 'following' && !canUseFollowing ? 'all' : scope

  useEffect(() => {
    let cancelled = false
    setPostsLoading(true)
    resolveFeed(effectiveScope)
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
    // Re-resolves (and re-freezes a fresh baseline) whenever the EFFECTIVE
    // scope changes — switching All Posts <-> Following is a re-fetch against
    // the same seam, not a mount-once concern (story 01's original effect
    // only ever ran once because `scope` was fixed at `'all'`). Depending on
    // `effectiveScope` (not the raw `scope` prop) means a session transition
    // that flips `canUseFollowing` (rare — a session doesn't change read-only
    // mid-mount in practice) still re-resolves correctly.
  }, [effectiveScope])

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
