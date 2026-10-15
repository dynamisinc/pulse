/**
 * features/social/pinned/pinEvents.ts
 * ---------------------------------------------------------------------------
 * Two tiny in-tab stores the Pinned tab and the Pin action share (demo-feedback story
 * 07). Participant world - pure module, no UI, no network, no clock.
 *
 * 1. `viewerEngagement` - a notification channel. Whenever the viewer's OWN pin or like
 *    on a post settles (a confirmed write, from any card on any surface) the action row
 *    calls `notify`. A mounted Pinned tab listens and re-reads `GET /api/feed/pinned`, so
 *    pinning, unpinning, liking or unliking anywhere updates the tab without a reload
 *    (the AC allows a re-fetch). In mock mode the channel is also how the mock pinned feed
 *    learns about likes (`mockPins.recordMockEngagement`). The event carries the post id,
 *    the kind and the new state - nothing else (no persona, no time).
 *
 * 2. `pinState` - the viewer's CONFIRMED personal pin per post, learned this session.
 *    Every card's Pin action reads it ahead of its own `post.viewer.pinned`, so a post
 *    shown on two surfaces at once (the All Posts card and the Pinned tab card) never
 *    disagrees after a pin on either.
 *
 * Both are identity-scoped and forgotten at every session reset (sign-out, sign-in).
 */

import { registerSessionReset } from '@/core/auth/sessionReset'

/** What changed: the viewer's own like or personal pin, or (mock only) an exercise pin. */
export type ViewerEngagementKind = 'like' | 'pin' | 'exercise'

/** One settled change. */
export interface ViewerEngagementEvent {
  readonly postId: string
  readonly kind: ViewerEngagementKind
  /** The state after the change. */
  readonly active: boolean
}

type EngagementListener = (event: ViewerEngagementEvent) => void

const engagementListeners = new Set<EngagementListener>()

/** The notification channel (see the module header). */
export const viewerEngagement = {
  /** Registers a listener; returns an idempotent unsubscribe. */
  subscribe(listener: EngagementListener): () => void {
    engagementListeners.add(listener)
    return () => {
      engagementListeners.delete(listener)
    }
  },
  /** Tells every listener a change settled. A throwing listener never starves the others. */
  notify(event: ViewerEngagementEvent): void {
    for (const listener of [...engagementListeners]) {
      try {
        listener(event)
      } catch {
        // Isolated: one consumer's failure is not the change's failure.
      }
    }
  },
}

let confirmedPins = new Map<string, boolean>()
const pinListeners = new Set<() => void>()
// Bumped on EVERY reset (even an empty one), so a write that started under an earlier
// identity can tell its answer is stale and must not repopulate the next viewer's state.
let resetGeneration = 0

/** The viewer's confirmed personal pins this session (see the module header). */
export const pinState = {
  /** The confirmed state for `postId`, or `undefined` when nothing was confirmed this session. */
  get(postId: string): boolean | undefined {
    return confirmedPins.get(postId)
  },
  /** Records a confirmed state and notifies subscribers (only when it changed). */
  set(postId: string, pinned: boolean): void {
    if (confirmedPins.get(postId) === pinned) return
    confirmedPins = new Map(confirmedPins).set(postId, pinned)
    for (const listener of [...pinListeners]) listener()
  },
  /** `useSyncExternalStore`-compatible subscribe. */
  subscribe(listener: () => void): () => void {
    pinListeners.add(listener)
    return () => {
      pinListeners.delete(listener)
    }
  },
  /**
   * The current reset generation. Capture it before a write; if it changed by the time the
   * write answers, a session reset happened in between and the answer belongs to the
   * previous identity (discard it).
   */
  generation(): number {
    return resetGeneration
  },
  /** Forgets everything (session reset; tests). Always advances the generation. */
  reset(): void {
    resetGeneration += 1
    if (confirmedPins.size === 0) return
    confirmedPins = new Map()
    for (const listener of [...pinListeners]) listener()
  },
}

registerSessionReset(() => pinState.reset(), import.meta.hot)
