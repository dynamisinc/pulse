/**
 * features/social/services/removedPosts.ts
 * ---------------------------------------------------------------------------
 * The session's set of TAKEN-DOWN post ids (demo-polish C5, story 22 "Takedown UI
 * and live feed removal"; CTL-025, XC-002, COR-001). A pure module-singleton data
 * store — no UI, no COBRA, no wall-clock — shared by both worlds as plain data.
 *
 * WHY IT EXISTS. A controller's takedown reaches an open participant feed as a
 * SignalR `PostRemoved { postId }` push (`realtimeFeed`), or — in mock mode, where
 * there is no hub — as a direct call from the console's `takedownService`. Either
 * way the effect is the same: "this id must stop being shown". Every surface that
 * could still be holding the post (the Home feed and its "new posts" buffer, the
 * Explore baseline that trending and search read) needs the SAME answer without
 * each of them wiring its own transport. This store is that one answer:
 *
 *   - `realtimeFeed` records an id here when a valid `PostRemoved` arrives
 *     (the singleton is wired at the bottom of that module);
 *   - the console's `takedownService` records the id on a successful takedown, so the
 *     console row can show "Removed" and a participant feed mounted in the same tab
 *     (mock mode, a staff preview) drops the post too;
 *   - `<Feed>` hides any displayed post whose id is here, drops it from the pill buffer
 *     and refuses to buffer it; the Explore store drops it from its baseline.
 *
 * WHAT IT HOLDS: opaque ids and nothing else — never the post's text, author or any
 * other content (XC-002). Consumers drop the whole post (the card leaves the DOM, the Explore
 * baseline forgets it) rather than mark it. This store does not reach into every in-memory cache:
 * the Home feed's frozen baseline and `ownPostStore` can still hold the removed post's view until
 * the next read or sign-out - nothing renders it.
 *
 * ISOLATION (COR-001). There is no `exerciseId` here and none is needed for
 * correctness: ids are server-issued GUIDs, unique across exercises, so an id only ever
 * suppresses exactly that one post. The set also dies with the SESSION —
 * `core/auth/endSession` calls {@link removedPosts.reset}, exactly as it does for
 * `ownPostStore` — so the next sign-in on the same tab never inherits it. This module
 * therefore stays a LEAF (no imports at all): `core/auth` imports it.
 *
 * SHAPE. `getAll()` returns a REFERENTIALLY-STABLE read-only snapshot (the identity only
 * changes on an `add` that adds something, or a `reset`), so `useSyncExternalStore` can
 * read it without looping and a consumer can memoize on it. It is bounded
 * ({@link REMOVED_POST_CAP}, oldest id evicted): takedowns are rare, deliberate acts,
 * but a store that can grow without limit is a bug waiting for a long exercise.
 * An id that was never displayed is recorded all the same (a baseline read may still be
 * in flight when the removal lands); a consumer that is not showing it simply ignores it.
 */

/** Most removed ids one session remembers (a moderation beat removes a handful). */
export const REMOVED_POST_CAP = 1000

/** Newest-removed last (a `Set` iterates in insertion order, which the eviction relies on). */
let removed: ReadonlySet<string> = new Set()

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** The removed ids. A stable snapshot: the identity changes only when the set does. */
function getAll(): ReadonlySet<string> {
  return removed
}

/** True when `postId` has been taken down in this session. */
function has(postId: string): boolean {
  return removed.has(postId)
}

/**
 * Records `postId` as taken down and wakes subscribers. Idempotent (a repeat is a no-op
 * and wakes nobody — the server's takedown is idempotent too, and a push can follow the
 * console's own call); an empty or non-string id is ignored. Past the cap the OLDEST id
 * is forgotten.
 */
function add(postId: string): void {
  if (typeof postId !== 'string' || postId.length === 0 || removed.has(postId)) return
  const next = new Set(removed)
  next.add(postId)
  if (next.size > REMOVED_POST_CAP) {
    const oldest = next.values().next()
    if (oldest.done !== true) next.delete(oldest.value)
  }
  removed = next
  notify()
}

/** Registers a change listener (fires when the set changes); returns an unsubscribe. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Forgets every removed id WITHOUT notifying (Gate-2 B L-3). The sign-out path
 * (`core/auth/endSession`) calls this, and sign-out unmounts every consumer a moment later.
 * Notifying here would be a blocking update that can commit once, with the set empty, BEFORE
 * the router's (transition) navigation to /login does - re-rendering a taken-down post for a
 * frame. Silent is safe: the ids are unique server GUIDs and the server omits removed posts,
 * and a consumer that outlives the reset (a test, a tab that stays) reads the new, empty
 * snapshot on its next render (`useSyncExternalStore` re-reads `getAll()` every render).
 * Listeners stay: they are the mounted components', which unmount themselves.
 */
function reset(): void {
  if (removed.size === 0) return
  removed = new Set()
}

/** Test-only: forgets every removed id and drops all listeners. */
function resetForTests(): void {
  removed = new Set()
  listeners.clear()
}

/** The module-singleton removed-post store. See the module header for the contract. */
export const removedPosts = {
  getAll,
  has,
  add,
  subscribe,
  reset,
  resetForTests,
}
