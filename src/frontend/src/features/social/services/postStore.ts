/**
 * features/social/services/postStore.ts
 * ---------------------------------------------------------------------------
 * The shared live post store (feature: feeds-discovery, story 07 — "Live post
 * store"; SOC-083 partial, COR-001, COR-053, XC-002, NFR-002/SOC-071). This is
 * the Wave-1 minimal slice of SOC-083 ("feeds update in real time... without
 * manual refresh"): a single in-memory, same-tab, module-singleton the feed's
 * read seam subscribes to, so a post appended after the feed has mounted
 * surfaces immediately, newest-first, via the feed's existing
 * `aria-live="polite"` announcement — WITHOUT a page reload, a full remount, or
 * a re-fetch of the seeded baseline.
 *
 * Participant world (Pulse Social skin) — pure data/service module, no UI, no
 * COBRA.
 *
 * DELIBERATELY MINIMAL (see the story's Out of Scope). This is NOT the buffered
 * "▲ N new posts" pill, the SignalR transport + polling fallback (NFR-003), the
 * hover-to-pause column, or the auto-scroll-suppression UX — those all remain
 * the FULL follow-up `04-realtime-new-posts-pill.md` (#123), which this slice
 * does not close or supersede. There is also no cross-tab / cross-participant
 * fan-out here: this is an in-memory store in one tab; a real push transport is
 * the eventual live host.
 *
 * SHAPE — a module-singleton, seeded ONCE from the shipped `listPosts()`:
 *   - `getPosts()`     Returns the current post set (baseline + appended), as a
 *                      REFERENTIALLY-STABLE snapshot: the same array identity is
 *                      returned until `appendPost` swaps it. That stability is
 *                      what lets a subscriber memoize on it (NFR-002/SOC-071)
 *                      and what keeps a `useSyncExternalStore`-style read from
 *                      looping. Callers treat the result as read-only (the feed
 *                      convergence never mutates it — it builds a fresh view
 *                      array).
 *   - `appendPost()`   Appends a post (insertion order — SORTING is
 *                      `assembleFeedView`'s job, not the store's) and notifies
 *                      every subscriber. The appended `Post` already carries its
 *                      own `exerciseId`, stamped upstream by `createPost`.
 *   - `subscribe()`    Registers a change listener; returns an unsubscribe.
 *   - `resetForTests()` Restores the seeded baseline and clears listeners, so
 *                      tests never pollute each other.
 *
 * ISOLATION (COR-001, XC-002) — exercise-scoped BY CONSTRUCTION, STAMPING-ONLY.
 * This store introduces NO client `exerciseId` query-scoping parameter anywhere
 * (WAVE0-REVIEW precedent 13): appended posts already carry their stamped
 * `exerciseId`, the session binds the exercise, and query scoping stays
 * server-side. Crucially, the store holds FULL `Post` records (they still carry
 * staff/telemetry-only provenance — `origin`/`actingHumanId`/`createdWallClock`
 * /`injectId`); `toParticipantView`/`assembleFeedView` remain the SOLE narrowing
 * on the read path, so a just-appended post's provenance is stripped on read
 * exactly like a seeded one (XC-002). The store never narrows and never renders.
 */

import { listPosts } from './postService'
import type { Post } from '../types/post'

/**
 * The current post set. Its identity is swapped (not mutated in place) on every
 * `appendPost`, so `getPosts()` returns a stable snapshot between appends.
 */
let posts: Post[] = listPosts()

/** Active change listeners; notified on every append. */
const listeners = new Set<() => void>()

/**
 * Returns the current post set (seeded baseline + anything appended since), in
 * insertion order. The returned reference is STABLE until the next `appendPost`
 * — do not mutate it; the feed convergence (`assembleFeedView`) reads it and
 * builds its own view array.
 */
function getPosts(): Post[] {
  return posts
}

/**
 * Appends a post and notifies every subscriber. The post is added in insertion
 * order — the newest-first ORDERING the feed shows is applied by
 * `assembleFeedView` (by `scenarioTime`, COR-053), not here. The appended
 * `Post` is a FULL record (provenance included); it is narrowed only on read.
 */
function appendPost(post: Post): void {
  posts = [...posts, post]
  for (const listener of listeners) listener()
}

/**
 * Subscribes to store changes. The listener fires after each `appendPost`;
 * re-read the current set via `getPosts()`. Returns an unsubscribe function.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Restores the seeded baseline and clears all listeners. Test-only — lets each
 * case start from the canonical seeded set with no cross-test pollution.
 */
function resetForTests(): void {
  posts = listPosts()
  listeners.clear()
}

/** The module-singleton live post store. See the module header for the contract. */
export const postStore = {
  getPosts,
  appendPost,
  subscribe,
  resetForTests,
}
