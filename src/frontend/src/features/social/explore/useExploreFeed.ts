/**
 * features/social/explore/useExploreFeed.ts
 * ---------------------------------------------------------------------------
 * The React binding for the shared Explore baseline (demo-polish F6; see
 * `exploreFeedStore.ts` for the what and why). Two hooks over ONE store:
 *
 *   - `useExploreBaseline()` — the raw participant-safe posts (+ status). What
 *     Trending reads: it needs no author, so it needs no persona read.
 *   - `useExploreFeed()` — the same posts assembled into `PostView`s with their
 *     authors, resolved from the channel's shared persona directory (the single
 *     persona read the Social channel already makes). What search reads. A post
 *     whose author is not in the cast is skipped, never a crash (as `useFeed` does).
 *
 * Subscribing IS acquiring: `useSyncExternalStore`'s subscribe ref-counts the store,
 * so the first mounted consumer starts the one feed read and the arrival stream and
 * the last one stops them. The store is keyed by exercise + account (+ whether the
 * mount may stream; local scope only — nothing here goes on the wire), so a different
 * session never sees the previous one's data (COR-001). An observer / read-only mount
 * (`affordancesAvailable(variant)` false, D1-011) subscribes without the arrival
 * stream: it gets the baseline read and never opens the shared transport.
 *
 * `loading` is true until the baseline read has settled (the store's `idle` and
 * `loading` both count), so no consumer ever flashes an empty state first.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useSession } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  affordancesAvailable,
  useShellContext,
} from '@/features/participant-shell/mountContract'
import type { Persona } from '@/features/personas'
import type { ParticipantPostView, PostView } from '@/features/social'
import { toPostView } from '../services/feedService'
import { useSocialDirectory } from '../layout/socialDirectory'
import { exploreFeedStore, type ExploreFeedStore } from './exploreFeedStore'

export interface UseExploreBaselineResult {
  /** Newest first, bounded (200), unique by id; the identity is stable between batches. */
  readonly posts: readonly ParticipantPostView[]
  /** True until the baseline read has settled. */
  readonly loading: boolean
  /** The baseline read failed (a retry is already scheduled). */
  readonly failed: boolean
}

/** The shared baseline, as participant-safe views (no authors). */
export function useExploreBaseline(
  store: ExploreFeedStore = exploreFeedStore,
): UseExploreBaselineResult {
  const { exerciseId } = useExerciseContext()
  const { accountId } = useSession()
  // D1-011: the arrival stream belongs to mounts with interactive affordances only --
  // the SAME predicate `Feed` (-> `useFeedStream`) and `ThreadView` (-> `useThread`) use.
  // An observer / read-only mount gets the one baseline read and no transport. The flag
  // is part of the scope key so a mount that flips it never reuses the other's baseline.
  const { variant } = useShellContext()
  const stream = affordancesAvailable(variant)
  const scopeKey = `${exerciseId}|${accountId}|${stream ? 'live' : 'static'}`

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(scopeKey, listener, { stream }),
    [store, scopeKey, stream],
  )
  const getSnapshot = useCallback(() => store.getSnapshot(scopeKey), [store, scopeKey])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    posts: snapshot.posts,
    loading: snapshot.status === 'idle' || snapshot.status === 'loading',
    failed: snapshot.status === 'error',
  }
}

export interface UseExploreFeedResult extends UseExploreBaselineResult {
  /** The baseline with each post's author resolved; newest first. */
  readonly views: readonly PostView[]
  /** The exercise cast (participant projection) — the People section's source. */
  readonly personas: readonly Persona[]
  /** The persona directory is still loading. */
  readonly peopleLoading: boolean
  /** The persona read failed and no cast is available. */
  readonly peopleFailed: boolean
}

/** The shared baseline as `PostView`s, plus the cast (for People). */
export function useExploreFeed(store: ExploreFeedStore = exploreFeedStore): UseExploreFeedResult {
  const baseline = useExploreBaseline(store)
  const directory = useSocialDirectory()
  const { personas } = directory

  const views = useMemo(() => {
    const byId = new Map(personas.map(persona => [persona.id, persona]))
    const assembled: PostView[] = []
    for (const post of baseline.posts) {
      const author = byId.get(post.authorPersonaId)
      if (author !== undefined) assembled.push(toPostView(post, author))
    }
    return assembled
  }, [baseline.posts, personas])

  return {
    ...baseline,
    views,
    personas,
    peopleLoading: directory.loading,
    peopleFailed: directory.error !== undefined && personas.length === 0,
  }
}
