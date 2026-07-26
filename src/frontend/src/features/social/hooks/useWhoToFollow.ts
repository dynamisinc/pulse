/**
 * features/social/hooks/useWhoToFollow.ts
 * ---------------------------------------------------------------------------
 * The data hook behind `<WhoToFollow>` (feature: profiles-social-graph, story
 * 04 — "Who to follow"; SOC-053, COR-001, D1-R1). Participant world (Pulse
 * Social skin) — pure hook, no UI, no COBRA. Mirrors `useFeed.ts`'s shape: a
 * thin `useState`/`useEffect` loader over the swappable read seam
 * (`whoToFollowService.resolveSuggestedFollowIds`), converged against
 * `usePersonas()` — ordinary cacheable data; a later refactor may lift this
 * onto React Query, the project default.
 *
 * WHAT THIS OWNS
 *  - Fetching the planner-seeded suggestion id order
 *    (`resolveSuggestedFollowIds`) and, when the session has a bound persona,
 *    that persona's real follow edges (`followService.resolveFollowing`) —
 *    run in parallel, mirroring `useFeed`'s posts+personas convergence.
 *  - THE TWO EXCLUSIONS THIS STORY OWNS (neither is a ranking — both are
 *    "would this row even make sense"):
 *      1. never suggest the viewer's OWN persona (a session with no bound
 *         persona, e.g. observer mode, excludes nothing on this basis);
 *      2. never suggest an account the viewer ALREADY follows (backend story
 *         07's following-read, per `implementation.md`'s Wave Plan note).
 *    Everything else about the ORDER is left exactly as
 *    `resolveSuggestedFollowIds()` returned it — no re-sort, no score, no
 *    verified-first bias. The SOC-052 impersonator is excluded ONLY if one of
 *    the two rules above applies to it (never because it is unverified) —
 *    D1-R1/D1-008.
 *  - An id the suggestion list names but `usePersonas()` cannot resolve is
 *    SKIPPED, never crashes the render (mirrors `assembleFeedView`'s
 *    missing-author guard).
 *
 * ISOLATION (COR-001): neither read takes a client `exerciseId` — the session
 * binds the exercise; query scoping is server-side.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/core/auth'
import { usePersonas, type Persona } from '@/features/personas'
import { resolveFollowing } from '../services/followService'
import { resolveSuggestedFollowIds } from '../services/whoToFollowService'

export interface UseWhoToFollowResult {
  /**
   * The suggested accounts, in the EXACT order the read returned (planner-
   * seeded today, CTL-021-adjustable later — see the module header), minus
   * the viewer's own persona and anything already followed.
   */
  readonly suggestions: readonly Persona[]
  /** True until every read this hook depends on has settled. */
  readonly loading: boolean
  /** First error from any read, or `undefined`. */
  readonly error: unknown
}

/**
 * Resolves the "Who to follow" suggestion set for the current session. See
 * the module header for the full contract; `<WhoToFollow>` is its only
 * intended consumer.
 */
export function useWhoToFollow(): UseWhoToFollowResult {
  const session = useSession()
  const { personas, loading: personasLoading, error: personasError } = usePersonas()

  const [suggestedIds, setSuggestedIds] = useState<readonly string[]>([])
  const [followingIds, setFollowingIds] = useState<readonly string[]>([])
  const [idsLoading, setIdsLoading] = useState(true)
  const [idsError, setIdsError] = useState<unknown>(undefined)

  const viewerPersonaId = session.personaId

  useEffect(() => {
    let cancelled = false
    setIdsLoading(true)

    // No bound persona (e.g. an observer session) → nothing to exclude on
    // "already followed", since there is no follow edge to have made.
    const followingRead = viewerPersonaId !== undefined
      ? resolveFollowing(viewerPersonaId)
      : Promise.resolve<string[]>([])

    Promise.all([resolveSuggestedFollowIds(), followingRead])
      .then(([ids, following]) => {
        if (cancelled) return
        setSuggestedIds(ids)
        setFollowingIds(following)
        setIdsError(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Fail closed: the suggestion list stays EMPTY rather than showing a
        // stale/partial one, and the error is surfaced to the caller.
        setIdsError(err)
      })
      .finally(() => {
        if (!cancelled) setIdsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [viewerPersonaId])

  const suggestions = useMemo(() => {
    const personaById = new Map<string, Persona>(personas.map(p => [p.id, p]))
    const alreadyFollowing = new Set(followingIds)

    const rows: Persona[] = []
    for (const id of suggestedIds) {
      if (id === viewerPersonaId) continue // never suggest following yourself
      if (alreadyFollowing.has(id)) continue // already a real follow edge
      const persona = personaById.get(id)
      if (!persona) continue // unresolvable id → skip, never crash the render
      rows.push(persona)
    }
    return rows
  }, [suggestedIds, followingIds, personas, viewerPersonaId])

  return {
    suggestions,
    loading: idsLoading || personasLoading,
    error: idsError ?? personasError,
  }
}
