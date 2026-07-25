/**
 * features/controller/services/liveStorylineStore.ts
 * ---------------------------------------------------------------------------
 * The LIVE escalation-dial data source (feature: world-steering, story 09 —
 * "Escalation dial live"; CTL-022, COR-001, COR-053). STAFF world — pure
 * data/service module, no UI, no COBRA. Used ONLY when `USE_MOCK_DATA` is
 * false; `useStorylineTarget`'s live branch reads this via
 * `useSyncExternalStore`, exactly like the mock branch reads `storylineMock`.
 *
 * POLLS, NEVER PUSHES — deliberate (Out of Scope per the story; keeps this
 * file-disjoint from story 08's SignalR broadcaster work). Mirrors
 * `liveReviewStore.ts`'s GET-seeds/reconcile shape MINUS the realtime
 * subscription: `ensureStarted(storylineId)` seeds the snapshot with an
 * initial GET, then refetches on a fixed interval (`POLL_MS`, ≈
 * `ReactionLoopHostOptions.TickInterval`'s 5s default) so the dial visibly
 * advances as the reaction loop's MEASURE stage chases a live target, without
 * over-polling. A documented follow-up may later replace this with a push
 * mirroring story 08's pattern once a broadcaster exists for storylines.
 *
 * STATUS, NOT JUST DATA (Gate-1 CR-002). A `null`/stale snapshot is
 * indistinguishable from "the storyline is genuinely quiet" if the caller
 * only ever sees numbers — so every read is `{ status, data }`:
 *   - `'loading'`   — no successful GET has landed yet (fresh mount, or a
 *     freshly re-pointed id).
 *   - `'live'`      — the last GET (or a POST's authoritative response)
 *     succeeded; `data` is trustworthy AS OF that response.
 *   - `'unavailable'` — the most recent GET failed (network, an expected
 *     pre-scope 401/403, or a 404 — e.g. the accepted `IReactionLoopRegistry`
 *     in-memory-loss limitation after an App Service restart, which then
 *     404s FOREVER until a re-seed). `data` is RETAINED (never blanked — the
 *     keep-previous-snapshot resilience is right) so a caller that wants the
 *     last-known numbers for context still can, but `status` tells the truth
 *     about whether they are current. `<EscalationDial>` must render this
 *     status explicitly rather than presenting stale/default numbers as fact.
 *
 * RECONCILIATION AFTER A WRITE (AC2). `reconcile(state)` lets the hook apply
 * the AUTHORITATIVE response from a `setStorylineTarget` POST immediately
 * (rather than waiting for the next poll tick) — the dial's optimistic local
 * update is corrected/confirmed against this the instant the POST resolves,
 * and `status` moves to `'live'` (a successful POST is itself live proof).
 *
 * RE-SYNC ON A FAILED WRITE (Gate-1 S-003). `refetchNow(storylineId)` is the
 * PUBLIC re-sync entry point a failed POST's `.catch` calls — re-reading the
 * server's ground truth rather than the caller restoring a captured pre-POST
 * snapshot, which could clobber a POLL that landed in between the optimistic
 * update and the rejection.
 *
 * REFERENCE-COUNTED LIFECYCLE (Gate-1 W-006). Unlike `liveReviewStore`'s
 * shared PUSH subscription (no recurring cost once connected),
 * a poll has an ongoing cost for as long as it runs. `ensureStarted` /
 * `release` are reference-counted: each mounted `<EscalationDial>` (via
 * `useStorylineTarget`'s `useEffect`) acquires once on mount and releases
 * once on unmount; the interval is torn down the instant the LAST consumer
 * releases, rather than running for the lifetime of the tab regardless of
 * whether anything is still reading it.
 *
 * MODULE SINGLETON (mirrors `liveReviewStore`). `resetForTests` clears
 * everything (test-only — prevents cross-test pollution / leaked intervals).
 */

import { getStoryline, type LiveStorylineSteeringState } from './liveStorylineActions'

/**
 * Roughly `ReactionLoopHostOptions.TickInterval`'s 5-second default — visible
 * advance, no over-polling.
 */
export const POLL_MS = 5000

/**
 * Whether the current snapshot is live-confirmed, still loading, or
 * unavailable (CR-002). See the module header.
 */
export type LiveStorylineDataStatus = 'loading' | 'live' | 'unavailable'

/** The combined status + data read every consumer sees — never data alone (CR-002). */
export interface LiveStorylineSnapshot {
  readonly status: LiveStorylineDataStatus
  readonly data: LiveStorylineSteeringState | null
}

const LOADING_SNAPSHOT: LiveStorylineSnapshot = { status: 'loading', data: null }

/** The current snapshot. Identity swaps (never mutates) on change. */
let current: LiveStorylineSnapshot = LOADING_SNAPSHOT

/** The storyline id the current poll is running for, or `null` when stopped. */
let startedForId: string | null = null

let pollHandle: ReturnType<typeof setInterval> | null = null

/** How many live consumers currently want this poll running (W-006). */
let subscriberCount = 0

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Returns the current `{ status, data }` snapshot. Stable reference until the next change. */
function getSnapshot(): LiveStorylineSnapshot {
  return current
}

/** Subscribes to snapshot changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function stopPolling(): void {
  if (pollHandle !== null) {
    clearInterval(pollHandle)
    pollHandle = null
  }
}

/**
 * Refetches `storylineId`. On success, replaces the snapshot with the fresh
 * data and marks it `'live'`. On failure (network, an expected pre-scope
 * 401/403, or a 404 before/after the exercise's storyline is registered),
 * marks the snapshot `'unavailable'` WITHOUT discarding the previous `data`
 * (CR-002) — the next poll tick may recover it.
 */
async function refetch(storylineId: string): Promise<void> {
  try {
    const next = await getStoryline(storylineId)
    current = { status: 'live', data: next }
    notify()
  } catch {
    current = { status: 'unavailable', data: current.data }
    notify()
  }
}

/**
 * Applies the AUTHORITATIVE response from a `setStorylineTarget` POST right
 * away (AC2) — the hook calls this the instant the POST resolves, so the
 * dial's optimistic local update reconciles immediately rather than waiting
 * for the next poll tick. A successful POST is itself live proof, so status
 * moves to `'live'`.
 */
function reconcile(state: LiveStorylineSteeringState): void {
  current = { status: 'live', data: state }
  notify()
}

/**
 * Acquires the live poll for `storylineId` (W-006 reference counting): the
 * FIRST acquire for a given id starts an initial GET + the recurring
 * interval; a subsequent acquire for the SAME id only bumps the reference
 * count (idempotent — a second mounted `<EscalationDial>` causes no
 * duplicate polling). Acquiring a DIFFERENT id tears the previous poll down,
 * resets to `'loading'`, and starts fresh. Pair every call with `release()`.
 */
function ensureStarted(storylineId: string): void {
  subscriberCount += 1

  if (startedForId !== storylineId) {
    stopPolling()
    startedForId = storylineId
    current = LOADING_SNAPSHOT
    notify()
  }

  if (pollHandle === null) {
    void refetch(storylineId)
    pollHandle = setInterval(() => void refetch(storylineId), POLL_MS)
  }
}

/**
 * Releases one reference acquired via `ensureStarted` (W-006). The poll is
 * torn down the instant the count reaches zero — e.g. the last mounted
 * `<EscalationDial>` unmounts — rather than running for the lifetime of the
 * tab. The snapshot/`startedForId` are left in place so a quick re-mount for
 * the SAME id resumes without a hard reset (a fresh `refetch` still fires
 * immediately on the next `ensureStarted`, since `pollHandle` is `null`).
 */
function release(): void {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount === 0) {
    stopPolling()
  }
}

/**
 * Re-syncs `storylineId` from the server right now (Gate-1 S-003) — the
 * PUBLIC entry point a failed write's `.catch` calls, rather than the caller
 * restoring a captured pre-POST snapshot (which could clobber a poll that
 * landed in between the optimistic update and the rejection). Shares the
 * exact same success/failure handling as the recurring poll.
 */
function refetchNow(storylineId: string): Promise<void> {
  return refetch(storylineId)
}

/**
 * Tears the poll down and clears the snapshot + listeners + reference count.
 * Test-only — prevents a live-mode test from leaking a running interval or a
 * stale snapshot into the next.
 */
function resetForTests(): void {
  stopPolling()
  startedForId = null
  subscriberCount = 0
  current = LOADING_SNAPSHOT
  listeners.clear()
}

/** The module-singleton live storyline data source. See the module header for the full contract. */
export const liveStorylineStore = {
  getSnapshot,
  subscribe,
  ensureStarted,
  release,
  reconcile,
  refetchNow,
  resetForTests,
}
