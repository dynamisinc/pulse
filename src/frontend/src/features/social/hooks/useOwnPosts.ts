/**
 * features/social/hooks/useOwnPosts.ts
 * ---------------------------------------------------------------------------
 * React binding for `ownPostStore` (demo-polish F4, story 13 "Own post appears
 * instantly"). Returns the viewer's own just-published posts as participant-safe
 * views, newest-registered first. The array identity is STABLE until a post is
 * registered, so `<Feed>` can `useMemo` on it and the memoized rows keep skipping
 * re-render under burst (NFR-002/SOC-071). Participant world — no UI, no COBRA.
 */

import { useSyncExternalStore } from 'react'
import { ownPostStore } from '../services/ownPostStore'
import type { ParticipantPostView } from '../types/post'

/** The viewer's own posts this session (see `services/ownPostStore`). */
export function useOwnPosts(): readonly ParticipantPostView[] {
  return useSyncExternalStore(ownPostStore.subscribe, ownPostStore.getAll)
}
