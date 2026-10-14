/**
 * features/controller/hooks/useRemovedPostIds.ts
 * ---------------------------------------------------------------------------
 * The console's REACTIVE read of "which posts are taken down" (demo-polish C5, story 22; CTL-025).
 * STAFF world — hooks with no UI. They exist so the orchestrator can wire the Live world column's
 * `isRowRemoved` prop (C2) to the same session store the row's Take down control writes:
 *
 *     const isRowRemoved = useIsRowRemoved()
 *     <LiveWorldColumn isRowRemoved={isRowRemoved} renderRowActions={renderTakedown} ... />
 *
 * THIS WIRING IS WHAT MAKES A ROW SAY "REMOVED". The column's `isRowRemoved` drives the persistent
 * REMOVED marker on the author line and disables "Reply as…" (and `R`) on a taken-down row; the
 * Take down slot (`liveWorld/TakedownAction`) deliberately draws no second "Removed" and renders
 * nothing for a takedown made elsewhere, so without this prop a removed row would show no marker.
 *
 * WHY HOOKS, NOT JUST `isPostRemoved`. The column memoizes its rows, so a predicate that reads
 * the store at call time would be correct but would never be CALLED again after a takedown — the
 * row would not re-render. {@link useIsRowRemoved} returns a predicate whose identity changes
 * exactly when the set of removed ids does (and never otherwise), so the owner of the column
 * re-renders on a takedown and the column sees a new predicate, while an unrelated re-render keeps
 * every row untouched (NFR-002 / SOC-071).
 *
 * WHERE THE IDS COME FROM: the session's `removedPosts` store, which a successful takedown on this
 * console and a `PostRemoved` push reaching this tab both write, and which `endSession` clears.
 * The Removed state therefore lives in the store keyed by post id, NOT in any component: a row that
 * unmounts (a filter change hides it) and remounts is still Removed.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { removedPosts } from '@/features/social/services/removedPosts'

/**
 * The ids taken down in this session. A stable read-only `Set`: its identity changes only when a
 * removal is recorded (or the session is reset), so it is safe as a memo dependency.
 */
export function useRemovedPostIds(): ReadonlySet<string> {
  return useSyncExternalStore(removedPosts.subscribe, removedPosts.getAll)
}

/**
 * A predicate for the column's `isRowRemoved` prop: true for a post that has been taken down.
 * Its identity is stable between removals and new after each one (see the module header).
 */
export function useIsRowRemoved(): (post: { readonly id: string }) => boolean {
  const ids = useRemovedPostIds()
  return useCallback((post: { readonly id: string }) => ids.has(post.id), [ids])
}
