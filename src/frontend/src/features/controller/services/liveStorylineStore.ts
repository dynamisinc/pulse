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
 *     THIS IS SELF-HEALING (Gate-2 W-105): the very next poll tick that
 *     succeeds moves status back to `'live'` — `'unavailable'` is not a
 *     terminal/sticky state.
 *
 * TWO INDEPENDENT GENERATION COUNTERS (Gate-2 W-102 + S-103) — responses
 * arrive in NETWORK order, not ISSUE order, so a stale one landing after a
 * newer request must never be applied:
 *   - `pollEpoch` bumps ONLY when `ensureStarted` re-points to a DIFFERENT
 *     storyline id. The poll (and its seeding GET) captures this epoch ONCE
 *     and every tick re-validates it before applying — closes S-103 (an
 *     in-flight GET for a PREVIOUS id landing as `'live'` after the id
 *     changed underneath it). Ordinary writes never bump this.
 *   - `writeGeneration` bumps on EVERY `beginWrite()` call (a NEW write
 *     attempt) — closes W-102 (e.g. `setTarget(60)` then `setTarget(80)`,
 *     B's response landing first, A's landing late: A's token is stale the
 *     instant B calls `beginWrite()`, so `reconcile`/`refetchNow` carrying
 *     A's token are dropped even though A's network response arrived AFTER
 *     B applied). Re-pointing to a different id ALSO bumps `writeGeneration`
 *     — an in-flight write for the OLD id must never land against the NEW
 *     one's snapshot.
 *
 * RECONCILIATION AFTER A WRITE (AC2). `reconcile(state, token)` lets the hook
 * apply the AUTHORITATIVE response from a `setStorylineTarget` POST
 * immediately (rather than waiting for the next poll tick) — the dial's
 * optimistic local update is corrected/confirmed against this the instant the
 * POST resolves, and `status` moves to `'live'` (a successful POST is itself
 * live proof) — UNLESS `token` is stale (W-102), in which case the call is a
 * silent no-op.
 *
 * OPTIMISTIC PATCHES PRESERVE STATUS (Gate-2 S-101). `applyOptimistic(patch)`
 * is the ONLY way a caller stamps an unconfirmed local guess onto the
 * snapshot — unlike `reconcile`, it does NOT force `status` to `'live'`; it
 * keeps whatever status was already there (`'loading'`/`'live'`/
 * `'unavailable'`). This makes CR-002's "never fabricate a confirmed read"
 * invariant airtight BY CONSTRUCTION (a local guess literally cannot flip the
 * store into looking authoritative) rather than by every call site
 * remembering to avoid `reconcile` for a guess.
 *
 * RE-SYNC ON A FAILED WRITE (Gate-1 S-003). `refetchNow(storylineId, token)`
 * is the PUBLIC re-sync entry point a failed POST's `.catch` calls —
 * re-reading the server's ground truth rather than the caller restoring a
 * captured pre-POST snapshot, which could clobber a POLL that landed in
 * between the optimistic update and the rejection. Also token-gated (W-102).
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

/**
 * The storyline id the current poll is running for, or `null` when stopped.
 * Gate-2 S-102 (noted, not built): a single id behind the shared reference
 * count means a DIFFERENT-id consumer would re-point the ONE poll out from
 * under an existing consumer. Unreachable today — the hook hard-codes
 * `PRIMARY_STORYLINE_SENTINEL`, so every consumer always requests the SAME
 * id — and stays unreachable until the Stories board (D5-016/017) lets a
 * controller address a specific storyline; THAT is the trigger to replace
 * this single id with an id-keyed map of independent polls.
 */
let startedForId: string | null = null

let pollHandle: ReturnType<typeof setInterval> | null = null

/** How many live consumers currently want this poll running (W-006). */
let subscriberCount = 0

/** Bumped ONLY on an id re-point (Gate-2 S-103). Guards the poll/seed GET. */
let pollEpoch = 0

/** Bumped on every `beginWrite()` AND on an id re-point (Gate-2 W-102). Guards write responses. */
let writeGeneration = 0

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
 * Refetches `storylineId`, applying the result only if `epoch` is STILL the
 * current `pollEpoch` (Gate-2 S-103) — a response for an id this store has
 * since moved on from is dropped, never applied as if it were current. On
 * success, replaces the snapshot with the fresh data and marks it `'live'`.
 * On failure (network, an expected pre-scope 401/403, or a 404 before/after
 * the exercise's storyline is registered), marks the snapshot `'unavailable'`
 * WITHOUT discarding the previous `data` (CR-002) — the next poll tick may
 * recover it (self-healing, Gate-2 W-105).
 */
async function refetchForEpoch(storylineId: string, epoch: number): Promise<void> {
  try {
    const next = await getStoryline(storylineId)
    if (epoch !== pollEpoch) return
    current = { status: 'live', data: next }
    notify()
  } catch {
    if (epoch !== pollEpoch) return
    current = { status: 'unavailable', data: current.data }
    notify()
  }
}

/**
 * Applies an UNCONFIRMED local guess (Gate-2 S-101) — the ONLY way a caller
 * stamps an optimistic patch onto the snapshot. Unlike `reconcile`, this
 * PRESERVES the current `status` rather than forcing `'live'`, so an
 * optimistic write can never make an unconfirmed/failed read masquerade as
 * confirmed (CR-002 stays airtight by construction). A no-op if there is no
 * data yet to patch onto.
 */
function applyOptimistic(patch: Partial<LiveStorylineSteeringState>): void {
  if (current.data === null) return
  current = { status: current.status, data: { ...current.data, ...patch } }
  notify()
}

/**
 * Begins a new write attempt (Gate-2 W-102) and returns its generation token.
 * The caller threads this token through `reconcile`/`refetchNow` for THIS
 * attempt only; a call carrying an OLDER token than the current
 * `writeGeneration` is a stale response — silently dropped, regardless of
 * arrival order.
 */
function beginWrite(): number {
  writeGeneration += 1
  return writeGeneration
}

/** Whether `token` (from a prior `beginWrite()`) is STILL the latest write attempt. */
function isCurrentWrite(token: number): boolean {
  return token === writeGeneration
}

/**
 * Applies the AUTHORITATIVE response from a `setStorylineTarget` POST right
 * away (AC2) — the hook calls this the instant the POST resolves, so the
 * dial's optimistic local update reconciles immediately rather than waiting
 * for the next poll tick. A successful POST is itself live proof, so status
 * moves to `'live'`. Dropped as stale (Gate-2 W-102) if `token` is no longer
 * the current write generation.
 */
function reconcile(state: LiveStorylineSteeringState, token: number): void {
  if (!isCurrentWrite(token)) return
  current = { status: 'live', data: state }
  notify()
}

/**
 * Acquires the live poll for `storylineId` (W-006 reference counting): the
 * FIRST acquire for a given id starts an initial GET + the recurring
 * interval; a subsequent acquire for the SAME id only bumps the reference
 * count (idempotent — a second mounted `<EscalationDial>` causes no
 * duplicate polling). Acquiring a DIFFERENT id tears the previous poll down,
 * bumps BOTH generation counters (Gate-2 W-102/S-103 — invalidates any
 * in-flight GET/write for the OLD id), resets to `'loading'`, and starts
 * fresh. Pair every call with `release()`.
 */
function ensureStarted(storylineId: string): void {
  subscriberCount += 1

  if (startedForId !== storylineId) {
    stopPolling()
    pollEpoch += 1
    writeGeneration += 1
    startedForId = storylineId
    current = LOADING_SNAPSHOT
    notify()
  }

  if (pollHandle === null) {
    const epoch = pollEpoch
    void refetchForEpoch(storylineId, epoch)
    pollHandle = setInterval(() => void refetchForEpoch(storylineId, epoch), POLL_MS)
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
 * landed in between the optimistic update and the rejection). Token-gated
 * (Gate-2 W-102): dropped as stale if a newer write has since begun.
 */
async function refetchNow(storylineId: string, token: number): Promise<void> {
  try {
    const next = await getStoryline(storylineId)
    if (!isCurrentWrite(token)) return
    current = { status: 'live', data: next }
    notify()
  } catch {
    if (!isCurrentWrite(token)) return
    current = { status: 'unavailable', data: current.data }
    notify()
  }
}

/**
 * Tears the poll down and clears the snapshot + listeners + reference count
 * + both generation counters. Test-only — prevents a live-mode test from
 * leaking a running interval or a stale snapshot into the next.
 */
function resetForTests(): void {
  stopPolling()
  startedForId = null
  subscriberCount = 0
  pollEpoch = 0
  writeGeneration = 0
  current = LOADING_SNAPSHOT
  listeners.clear()
}

/** The module-singleton live storyline data source. See the module header for the full contract. */
export const liveStorylineStore = {
  getSnapshot,
  subscribe,
  ensureStarted,
  release,
  applyOptimistic,
  beginWrite,
  isCurrentWrite,
  reconcile,
  refetchNow,
  resetForTests,
}
