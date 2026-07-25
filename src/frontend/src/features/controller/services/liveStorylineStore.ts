/**
 * features/controller/services/liveStorylineStore.ts
 * ---------------------------------------------------------------------------
 * The LIVE escalation-dial data source (feature: world-steering, story 09 —
 * "Escalation dial live"; CTL-022, COR-001, COR-053). STAFF world — pure
 * data/service module, no UI, no COBRA. Used ONLY when `USE_MOCK_DATA` is
 * false (`@/core/config/mockData`); `useStorylineTarget`'s live branch reads
 * this via `useSyncExternalStore`, exactly like the mock branch reads
 * `storylineMock`.
 *
 * POLLS, NEVER PUSHES — deliberate (Out of Scope per the story; keeps this
 * file-disjoint from story 08's SignalR overlay-broadcaster work). Mirrors
 * `liveReviewStore.ts`'s GET-seeds/reconcile shape MINUS the realtime
 * subscription: `ensureStarted(storylineId)` seeds the snapshot with an
 * initial GET, then refetches on a fixed interval (`POLL_MS`, ≈
 * `ReactionLoopHostOptions.TickInterval`'s 5s default) so the dial visibly
 * advances as the reaction loop's MEASURE stage chases a live target, without
 * over-polling. A documented follow-up may later replace this with a push
 * mirroring story 08's pattern once a broadcaster exists for storylines.
 *
 * RESILIENCE (COR-001, light, in-scope). A GET failure — network, or the
 * expected pre-scope 401/403, or a 404 before the exercise's storyline is
 * registered — leaves the PREVIOUS snapshot in place rather than substituting
 * a blank/default storyline; the next poll retries.
 *
 * RECONCILIATION AFTER A WRITE (AC2). `reconcile(state)` lets the hook apply
 * the AUTHORITATIVE response from a `setStorylineTarget` POST immediately
 * (rather than waiting for the next poll tick) — the dial's optimistic local
 * update is corrected/confirmed against this the instant the POST resolves.
 *
 * MODULE SINGLETON (mirrors `liveReviewStore`). `ensureStarted` is idempotent
 * for the SAME storyline id (a second `<EscalationDial>` mount is a no-op);
 * calling it with a DIFFERENT id (a future multi-storyline board re-pointing
 * the dial) tears the previous poll down and starts a fresh one.
 * `resetForTests` clears everything (test-only — prevents cross-test
 * pollution / leaked intervals).
 */

import { getStoryline, type LiveStorylineSteeringState } from './liveStorylineActions'

/**
 * Roughly `ReactionLoopHostOptions.TickInterval`'s 5-second default — visible
 * advance, no over-polling.
 */
export const POLL_MS = 5000

/**
 * The current snapshot, or `null` before the first GET resolves. Identity
 * swaps (never mutates) on change.
 */
let snapshot: LiveStorylineSteeringState | null = null

/** The storyline id the current poll is running for, or `null` when stopped. */
let startedForId: string | null = null

let pollHandle: ReturnType<typeof setInterval> | null = null

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Returns the current snapshot, or `null` before the first successful GET.
 * Stable reference until the next change.
 */
function getSnapshot(): LiveStorylineSteeringState | null {
  return snapshot
}

/** Subscribes to snapshot changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Refetches `storylineId` and replaces the snapshot wholesale on success.
 * Fails closed (COR-001) on a request error or a malformed body by leaving
 * the PREVIOUS snapshot in place — never substitutes an empty/default
 * storyline.
 */
async function refetch(storylineId: string): Promise<void> {
  try {
    const next = await getStoryline(storylineId)
    snapshot = next
    notify()
  } catch {
    // Transient failure (including an expected pre-scope 401/403, or a 404
    // before the exercise's storyline is registered) — keep the previous
    // snapshot; the next poll tick retries.
  }
}

/**
 * Applies the AUTHORITATIVE response from a `setStorylineTarget` POST right
 * away (AC2) — the hook calls this the instant the POST resolves, so the
 * dial's optimistic local update reconciles immediately rather than waiting
 * for the next poll tick.
 */
function reconcile(state: LiveStorylineSteeringState): void {
  snapshot = state
  notify()
}

/**
 * Starts (or re-points) the live poll. A call for the SAME `storylineId` the
 * poll is already running for is a no-op (idempotent across every hook
 * mount); a call for a DIFFERENT id tears the previous poll down first.
 */
function ensureStarted(storylineId: string): void {
  if (startedForId === storylineId) return
  if (pollHandle !== null) clearInterval(pollHandle)

  startedForId = storylineId
  void refetch(storylineId)
  pollHandle = setInterval(() => void refetch(storylineId), POLL_MS)
}

/**
 * Tears the poll down and clears the snapshot + listeners. Test-only —
 * prevents a live-mode test from leaking a running interval or a stale
 * snapshot into the next.
 */
function resetForTests(): void {
  if (pollHandle !== null) clearInterval(pollHandle)
  pollHandle = null
  startedForId = null
  snapshot = null
  listeners.clear()
}

/** The module-singleton live storyline data source. See the module header for the full contract. */
export const liveStorylineStore = {
  getSnapshot,
  subscribe,
  ensureStarted,
  reconcile,
  resetForTests,
}
