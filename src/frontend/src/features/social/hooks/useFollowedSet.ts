/**
 * features/social/hooks/useFollowedSet.ts
 * ---------------------------------------------------------------------------
 * "Does the viewer follow this account?" — as a STABLE, always-current
 * predicate (feature: feeds-discovery, story 08 "follow-aware feed stream",
 * #91/relates #121; SOC-081, SOC-083, COR-001, NFR-002/SOC-071).
 * Participant world (Pulse Social skin) — pure hook, no UI, no COBRA.
 *
 * WHY IT EXISTS. The live feed stream (`useFeedStream`) buffers EVERY arrival
 * the transport delivers, because a transport is deliberately author-agnostic.
 * A Following-scoped feed must only count arrivals from accounts the reader
 * actually follows, so `<Feed>` hands the stream an `admit` predicate — and
 * that predicate needs the viewer's followed set, cheaply, on the hot path of a
 * 120-posts/min burst.
 *
 * THE SHAPE, AND WHY IT IS A REF AND NOT STATE. `isFollowed` is a PERMANENTLY
 * stable callback (empty dep list) that reads the followed set out of a ref:
 *   - Stable identity is required by `useFeedStream`'s `admit` contract — it is
 *     an effect dependency, so a predicate that changed identity whenever the
 *     followed set moved would unsubscribe/re-subscribe the stream on every
 *     follow toggle. On the live transport that means tearing down the shared
 *     SignalR subscription and re-running `start()` mid-session, for a filter
 *     change the transport does not even know about. With a ref, following an
 *     account mid-session changes what is admitted WITHOUT touching the
 *     subscription at all.
 *   - It also costs zero re-renders: the set is consulted per ARRIVAL, never
 *     rendered, so putting it in React state would re-render the feed page for
 *     data no pixel depends on (NFR-002/SOC-071).
 * The ref is only ever WRITTEN in an effect/async continuation and only ever
 * READ inside the callback — never during render (React Compiler's rule).
 *
 * HOW IT STAYS CURRENT (the mid-session follow). The set is resolved once per
 * viewer through `followService.resolveFollowing` (the server-authoritative
 * seam — COR-001: no client `exerciseId`, and in mock mode the SAME
 * `followEdgeStore` the Following feed's own filter reads), and re-resolved on
 * every `subscribeFollowChanges` notification — i.e. after any successful
 * follow/unfollow anywhere in the app (`useFollow` funnels through those two
 * writes). So following an account from the profile page while the Following
 * tab is mounted behind it makes that account's next post start counting,
 * without a remount and without a poll. Deliberately NOT done by reading the
 * mock edge store directly: that store only exists in mock mode, and a shipped
 * read path must never depend on it.
 *
 * FAIL-CLOSED. Before the first resolve settles — and if a resolve REJECTS —
 * the set is empty, so `isFollowed` answers `false` for everyone. Under the
 * Following label that degrades to "no pill", never to "a pill counting posts
 * from accounts you don't follow": an absent affordance is honest, a wrong one
 * is not. (The pre-resolve window is the same window in which the stream source
 * is still baselining, so nothing extra is lost there.)
 *
 * NOT A RENDER SEAM. This hook deliberately returns no list, no `loading`, and
 * no `error` — it exists to answer one boolean on the arrival path. A surface
 * that needs to RENDER follow state resolves its own (`<Profile>`,
 * `useWhoToFollow`) rather than widening this one.
 */

import { useCallback, useEffect, useRef } from 'react'
import { resolveFollowing, subscribeFollowChanges } from '../services/followService'

/** Shared empty set for the "no viewer / not resolved yet" state — never mutated. */
const EMPTY_FOLLOWED_SET: ReadonlySet<string> = new Set<string>()

export interface UseFollowedSetResult {
  /**
   * True when `personaId` is in the viewer's currently-known followed set.
   * STABLE identity for the life of the component (safe as an effect
   * dependency); always reads the latest resolved set.
   */
  readonly isFollowed: (personaId: string) => boolean
}

/**
 * Tracks the followed set of `viewerPersonaId` and exposes it as a stable
 * predicate. Passing `undefined` (no bound persona, or a caller that does not
 * need the set — e.g. an All Posts feed) issues NO request at all and leaves
 * the predicate answering `false`. See the module header for the full contract.
 */
export function useFollowedSet(viewerPersonaId: string | undefined): UseFollowedSetResult {
  // The set is arrival-path data, not render state — see the module header.
  const followedRef = useRef<ReadonlySet<string>>(EMPTY_FOLLOWED_SET)

  useEffect(() => {
    // No viewer to resolve for: answer `false` for everyone and issue nothing.
    if (viewerPersonaId === undefined) {
      followedRef.current = EMPTY_FOLLOWED_SET
      return
    }

    let cancelled = false
    const load = () => {
      resolveFollowing(viewerPersonaId)
        .then(ids => {
          if (!cancelled) followedRef.current = new Set(ids)
        })
        .catch(() => {
          // Fail closed (module header): a failed read must never assert a
          // follow relationship the viewer may not have.
          if (!cancelled) followedRef.current = EMPTY_FOLLOWED_SET
        })
    }

    load()
    // Re-read after any successful follow/unfollow in the app, so an account
    // followed while this feed is mounted starts being admitted immediately.
    const unsubscribe = subscribeFollowChanges(load)

    return () => {
      cancelled = true
      unsubscribe()
      // Drop the previous viewer's set rather than let it answer for the next
      // one until the fresh read lands (fail closed, never fail stale).
      followedRef.current = EMPTY_FOLLOWED_SET
    }
  }, [viewerPersonaId])

  const isFollowed = useCallback(
    (personaId: string) => followedRef.current.has(personaId),
    [],
  )

  return { isFollowed }
}
