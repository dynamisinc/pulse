/**
 * features/controller/engine/services/liveReviewStore.ts
 * ---------------------------------------------------------------------------
 * The LIVE review-queue data source (feature: engine-review-cockpit, story 02
 * mock→live flip; ADP-040, COR-001, COR-053, XC-002). STAFF world — pure
 * data/service module, no UI, no COBRA. Used ONLY when `USE_MOCK_DATA` is
 * false (`@/core/config/mockData`); `useReviewQueue` selects between this and
 * the mock `reviewStore` behind that one flag, so this module is never
 * exercised in dev/UAT (both always run on mock data).
 *
 * SAME SURFACE AS `reviewStore` (`getItems`/`subscribe`), so `useReviewQueue`
 * can `useSyncExternalStore` this module exactly like the mock one with no
 * change to its own shape. Additionally exposes `ensureStarted()` (idempotent
 * — kicks off the initial GET + the realtime subscription the first time any
 * hook instance mounts live) and `removeItemOptimistically()` (the write side
 * calls this right after firing an approve/edit/veto/batch-approve POST, so
 * the queue updates immediately rather than waiting on the round trip).
 *
 * THE WIRE CONTRACT (story 02, frozen). `GET /api/engine/review-queue` returns
 * an array of the `EngineReviewItemDto` wire shape — camelCase, kebab enum
 * literals, GUID strings, a nullable `countdown`, `posts[]` present (the DTO
 * carries the full drafts; see that C# type's header for why). Each element is
 * mapped into this cockpit's frozen `reviewContracts` `EngineReviewItem` (and
 * its `countdown` into a `DelayedAutoCountdown`) via their constructors — no
 * invented fields, a field-for-field mirror of the DTO.
 *
 * REALTIME RECONCILIATION. The shared `core/realtime` connection (the ONE
 * connection every consumer attaches to — no second hub) pushes
 * `ReviewItemChanged` with a single changed item's wire DTO. Reconciliation is
 * by `draftId` + disposition:
 *   - `published` / `vetoed` (resolved) → the item LEAVES the local queue
 *     (mirrors the live GET's own contract: "queued + counting-down + held;
 *     resolved items excluded" — a resolved item is no longer part of "the
 *     queue" once the backend is the source of truth);
 *   - anything else (`queued` / `counting-down` / `held`) → upsert in place
 *     (covers "moved to NEEDS YOU" on an auto-HOLD fire and any countdown/
 *     disposition change).
 * A malformed push payload is dropped, never cast blindly (defence in depth —
 * the server already only emits the frozen shape).
 *
 * RESILIENCE (light, in-scope). The initial `GET` seeds the snapshot; a hub
 * reconnect (`onStateChange` → `Connected`, including the very first connect)
 * triggers a fresh `GET` to resync anything missed while disconnected — the
 * push stream is best-effort, the GET is the ground truth. A GET failure
 * (including the expected pre-scope 401 — story 02 fails closed until B2
 * populates per-request scope) leaves the previous snapshot in place rather
 * than clearing the queue; it is retried on the next reconnect.
 *
 * MODULE SINGLETON (mirrors `reviewStore`/`postStore`). `ensureStarted()` is
 * idempotent across every hook mount — the underlying GET + subscription
 * happen once, not once per `<ReviewQueue>` instance. `resetForTests()` tears
 * the subscription down and clears the snapshot (test-only, prevents
 * cross-test pollution / duplicate `HubConnection` builds).
 *
 * REFRESH DISCIPLINE (one GET at a time, never stale over a push). Three rules:
 *  1. COALESCING. `refetch()` while a GET is in flight returns that SAME promise - never a second
 *     request. Any number of callers (reconnect, driver nudges, the scheduler) share one GET.
 *  2. STALE-RESPONSE GUARD. A monotonic `version` is bumped on every applied SignalR push and
 *     every local mutation (`removeItemOptimistically`). A GET records `version` when it starts;
 *     if it moved by the time the response lands, the response may predate a push (it could erase
 *     a newly queued draft or resurrect a published one as CountingDown), so it is DISCARDED and
 *     a fresh GET is issued (bounded retries; the pushes already applied remain the truth if
 *     we give up). Chosen over per-item merging because it is simplest and always correct: the
 *     replacement GET starts after the push, so the server's answer includes it. A GET is also
 *     discarded if a newer-started GET has already committed (`committedSeq`).
 *     INVALIDATION (trailing refresh). Coalescing alone would swallow a "server state may have
 *     changed WITHOUT a push" signal: a hub Connected/Reconnected that lands while the initial GET
 *     is pending would share that GET, which may predate a draft created before the hub joined
 *     (no push is ever delivered for it, so `version` is unchanged and the stale response would
 *     commit). So `refetch({ invalidate: true })` - used by the hub-connect trigger - sets a
 *     one-shot `trailingRequested` flag when a GET is in flight; when that GET cycle ends exactly
 *     ONE more GET runs (any number of invalidations while pending collapse into that one).
 *     Plain `refetch()` (expiry nudges, drivers) still just shares the in-flight GET. Chosen over
 *     a separate invalidation counter in the commit check because the flag needs no change to
 *     the stale guard and the returned promise resolves only after the trailing GET.
 *  2b. RECONCILIATION AFTER EXHAUSTED RETRIES. If every bounded immediate retry is discarded
 *     (pushes kept landing), the pushes applied locally stand, but items that exist only on the
 *     server (e.g. a Suggest draft created before load) would stay hidden: pushes do not trigger
 *     GETs and Suggest drafts have no expiry poller. So exhaustion schedules a backed-off
 *     reconciliation GET (2 s -> 5 s -> 15 s, capped at 15 s), repeated until a GET commits.
 *     Chosen over per-item merging: a merge cannot tell "absent from the response because stale"
 *     from "absent because resolved" without per-item versions, whereas a committed wholesale GET
 *     is always correct. The timer is cleared on commit, session reset and `resetForTests`.
 *  3. ONE EXPIRY SCHEDULER. Live draft timers are display-only, so when a countdown reaches 0 the
 *     server's verdict must be pulled. `requestExpiryRefresh()` (idempotent; the per-item
 *     `DraftTimerDriver`s call it) starts a SINGLE queue-level poller that runs while ANY
 *     CountingDown item is past its deadline (scenario clock), at most one GET per 3 s, and stops
 *     when none remain. If the same expired set persists (e.g. FullStop leaves countdowns
 *     unresolved) the interval backs off 3 s -> 10 s -> 30 s (cap), one step per 5 polls.
 *
 * THE SESSION ENDS (COR-001). This singleton lives as long as the TAB, but its snapshot, its
 * GET and its hub connection all belong to ONE staff identity (and one exercise). So it
 * registers a reset with `core/auth/sessionReset`, which `resetClientSession()` runs on
 * sign-out and on every sign-in, alongside `core/realtime`'s own reset that STOPS the shared
 * connection. The store then: detaches from the connection and marks itself not started (so the
 * next `ensureStarted()` - the next console mount - does a full fresh start: GET, subscribe and
 * `connection.start()`, which opens a new connection on the NEW token); forgets the previous
 * identity's items (a GET that fails would otherwise leave them on screen under the new
 * identity); and bumps `epoch`, so a GET still in flight for the old identity is discarded
 * instead of landing in the new one's snapshot. If a console is STILL mounted (a listener is
 * subscribed) it re-attaches itself - deferred a microtask, so the connection's stop has begun
 * whatever order the resets ran in, and only when a session token is stored (a sign-out has
 * just removed it: there is nothing to attach as).
 */

import { api } from '@/core/services/api'
import { scenarioNow } from '@/core/clock'
import { getAccessToken } from '@/core/auth/tokenStore'
import { registerSessionReset } from '@/core/auth/sessionReset'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'
import {
  AutonomyLevel,
  ControllerDecision,
  DelayedAutoCountdown,
  DraftDisposition,
  EngineReviewItem,
  scenarioMinuteOf,
  type GeneratedPost,
} from '../models/reviewContracts'

/** The SignalR client event `EngineReviewBroadcaster` pushes a changed item on. */
const REVIEW_ITEM_CHANGED_EVENT = 'ReviewItemChanged'

/** `GET /api/engine/review-queue` (relative to the shared axios client's `/api` base). */
const REVIEW_QUEUE_PATH = '/engine/review-queue'

const AUTONOMY_LEVELS: ReadonlySet<string> = new Set(Object.values(AutonomyLevel))
const DISPOSITIONS: ReadonlySet<string> = new Set(Object.values(DraftDisposition))
const DECISIONS: ReadonlySet<string> = new Set(Object.values(ControllerDecision))

// ---------------------------------------------------------------------------
// Wire shapes + validation (fail-closed narrowing, never a blind cast)
// ---------------------------------------------------------------------------

interface WireGeneratedPost {
  readonly personaHandle: string
  readonly text: string
  readonly sentiment: number
  readonly hashtags: readonly string[]
}

interface WireCountdown {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly startedScenarioMinute: number
  readonly countdownMinutes: number
  readonly decision: string
}

interface WireReviewItem {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly routedAtLevel: string
  readonly disposition: string
  readonly countdown: WireCountdown | null
  readonly posts: readonly WireGeneratedPost[]
  readonly storylineTag: string
  readonly storylineBrief: string
  readonly actionLabel: string
}

function isWireGeneratedPost(value: unknown): value is WireGeneratedPost {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.personaHandle === 'string' &&
    typeof p.text === 'string' &&
    typeof p.sentiment === 'number' &&
    Array.isArray(p.hashtags) && p.hashtags.every(tag => typeof tag === 'string')
  )
}

function isWireCountdown(value: unknown): value is WireCountdown {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.exerciseId === 'string' && c.exerciseId.length > 0 &&
    typeof c.storylineId === 'string' && c.storylineId.length > 0 &&
    typeof c.draftId === 'string' && c.draftId.length > 0 &&
    typeof c.startedScenarioMinute === 'number' &&
    typeof c.countdownMinutes === 'number' &&
    typeof c.decision === 'string' && DECISIONS.has(c.decision)
  )
}

function isWireReviewItem(value: unknown): value is WireReviewItem {
  if (typeof value !== 'object' || value === null) return false
  const i = value as Record<string, unknown>
  return (
    typeof i.exerciseId === 'string' && i.exerciseId.length > 0 &&
    typeof i.storylineId === 'string' && i.storylineId.length > 0 &&
    typeof i.draftId === 'string' && i.draftId.length > 0 &&
    typeof i.routedAtLevel === 'string' && AUTONOMY_LEVELS.has(i.routedAtLevel) &&
    typeof i.disposition === 'string' && DISPOSITIONS.has(i.disposition) &&
    (i.countdown === null || i.countdown === undefined || isWireCountdown(i.countdown)) &&
    Array.isArray(i.posts) && i.posts.every(isWireGeneratedPost) &&
    typeof i.storylineTag === 'string' &&
    typeof i.storylineBrief === 'string' &&
    typeof i.actionLabel === 'string'
  )
}

function isWireReviewItemArray(value: unknown): value is WireReviewItem[] {
  return Array.isArray(value) && value.every(isWireReviewItem)
}

/**
 * Maps a validated wire item into the frozen `EngineReviewItem` (and its
 * `countdown` into a `DelayedAutoCountdown`) via their constructors — a
 * field-for-field port, nothing invented.
 */
function toEngineReviewItem(wire: WireReviewItem): EngineReviewItem {
  const countdown = wire.countdown
    ? new DelayedAutoCountdown({
      exerciseId: wire.countdown.exerciseId,
      storylineId: wire.countdown.storylineId,
      draftId: wire.countdown.draftId,
      startedScenarioMinute: wire.countdown.startedScenarioMinute,
      countdownMinutes: wire.countdown.countdownMinutes,
      decision: wire.countdown.decision as ControllerDecision,
    })
    : null

  const posts: GeneratedPost[] = wire.posts.map(post => ({
    personaHandle: post.personaHandle,
    text: post.text,
    sentiment: post.sentiment,
    hashtags: post.hashtags,
  }))

  return new EngineReviewItem({
    exerciseId: wire.exerciseId,
    storylineId: wire.storylineId,
    draftId: wire.draftId,
    routedAtLevel: wire.routedAtLevel as AutonomyLevel,
    disposition: wire.disposition as DraftDisposition,
    countdown,
    posts,
    storylineTag: wire.storylineTag,
    storylineBrief: wire.storylineBrief,
    actionLabel: wire.actionLabel,
  })
}

function isResolved(disposition: DraftDisposition): boolean {
  return disposition === DraftDisposition.Published || disposition === DraftDisposition.Vetoed
}

// ---------------------------------------------------------------------------
// Module-singleton snapshot + subscription (mirrors reviewStore's shape)
// ---------------------------------------------------------------------------

/** The current snapshot. Identity is swapped (never mutated in place) on every change. */
let items: readonly EngineReviewItem[] = []

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

let started = false
let unsubscribePush: (() => void) | null = null
let unsubscribeState: (() => void) | null = null

/** The connection `ensureStarted` attached to, so a session reset can re-attach to the same one. */
let attachedConnection: RealtimeConnection = realtimeConnection

/**
 * Bumped whenever the session ends. A GET carries the epoch it was issued in and is discarded
 * if it moved, so a response for a previous identity can never land in the next one's snapshot.
 */
let epoch = 0

function notify(): void {
  for (const listener of listeners) listener()
}

/** Returns the current review-item snapshot. Stable reference until the next mutation. */
function getItems(): readonly EngineReviewItem[] {
  return items
}

/** Subscribes to snapshot changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Monotonic; bumped on every applied push and local mutation (see "REFRESH DISCIPLINE"). */
let version = 0
/** Sequence numbers of GETs started / last committed, so an older GET never overwrites a newer. */
let getSeq = 0
let committedSeq = 0
/** The single in-flight GET, shared by every concurrent `refetch()` caller. */
let inFlight: Promise<void> | null = null
/** Stale-discard retries allowed per refetch call before giving up. */
const MAX_STALE_RETRIES = 2
/** One-shot: an invalidating refetch arrived while a GET was in flight; run one more after it. */
let trailingRequested = false
/** Backed-off reconciliation after exhausted stale retries (see "REFRESH DISCIPLINE" 2b). */
const RECONCILE_DELAYS_MS = [2000, 5000, 15_000] as const
let reconcileTimer: ReturnType<typeof setTimeout> | null = null
let reconcileAttempts = 0

function clearReconcile(): void {
  if (reconcileTimer !== null) clearTimeout(reconcileTimer)
  reconcileTimer = null
  reconcileAttempts = 0
}

function scheduleReconcile(): void {
  if (reconcileTimer !== null) return
  const delay = RECONCILE_DELAYS_MS[Math.min(reconcileAttempts, RECONCILE_DELAYS_MS.length - 1)]
  reconcileAttempts += 1
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    void refetch()
  }, delay)
}

interface RefetchOptions {
  /** Server state may have changed without a push: guarantee a GET that STARTS after this call. */
  readonly invalidate?: boolean
}

/** Expiry scheduler tuning: base interval, then backoff steps after STEP_POLLS unchanged polls. */
const EXPIRY_POLL_INTERVALS_MS = [3000, 10_000, 30_000] as const
const EXPIRY_POLLS_PER_STEP = 5
let expiryTimer: ReturnType<typeof setTimeout> | null = null
let expiryRunning = false
let expirySignature = ''
let expiryUnchangedPolls = 0

/**
 * Refetches the queue from the server and replaces the snapshot wholesale - COALESCED (a call
 * while a GET is in flight returns that GET's promise) and STALE-GUARDED (see the module header).
 * Fails closed (COR-001) on a request error or a malformed body by leaving the
 * PREVIOUS snapshot in place - never substitutes an empty/default queue.
 */
function refetch(options: RefetchOptions = {}): Promise<void> {
  if (inFlight !== null) {
    if (options.invalidate === true) trailingRequested = true
    return inFlight
  }
  const run: Promise<void> = runCycle().finally(() => {
    if (inFlight === run) inFlight = null
  })
  inFlight = run
  return run
}

/** One GET (with bounded stale retries) plus at most one trailing GET per invalidation burst. */
async function runCycle(): Promise<void> {
  const issuedInEpoch = epoch
  trailingRequested = false
  let outcome = await runGet(MAX_STALE_RETRIES)
  while (trailingRequested && issuedInEpoch === epoch) {
    trailingRequested = false
    outcome = await runGet(MAX_STALE_RETRIES)
  }
  if (outcome === 'exhausted' && issuedInEpoch === epoch) scheduleReconcile()
}

type GetOutcome = 'committed' | 'exhausted' | 'other'

async function runGet(staleRetriesLeft: number): Promise<GetOutcome> {
  const issuedInEpoch = epoch
  const startedAtVersion = version
  getSeq += 1
  const seq = getSeq
  try {
    const response = await api.get<unknown>(REVIEW_QUEUE_PATH)
    if (issuedInEpoch !== epoch) return 'other' // for an identity that has since ended
    if (seq < committedSeq) return 'other' // a newer GET already committed
    if (!isWireReviewItemArray(response.data)) return 'other'
    if (version !== startedAtVersion) {
      // A push / local mutation landed while this GET was pending: it may predate it. Discard,
      // then issue a fresh GET (it starts after the push, so it reflects it).
      if (staleRetriesLeft > 0) return await runGet(staleRetriesLeft - 1)
      return 'exhausted'
    }
    committedSeq = seq
    clearReconcile()
    items = response.data.map(toEngineReviewItem)
    notify()
    return 'committed'
  } catch {
    // Transient failure (including the expected pre-scope 401) - keep the
    // previous snapshot; the next hub reconnect retries.
    return 'other'
  }
}

// ---------------------------------------------------------------------------
// The single expiry scheduler (see "REFRESH DISCIPLINE" rule 3)
// ---------------------------------------------------------------------------

/** The CountingDown items whose countdown is past its deadline right now (scenario clock). */
function expiredCountingDownDraftIds(): string[] {
  const minute = scenarioMinuteOf(scenarioNow().getTime())
  return items
    .filter(
      item =>
        item.disposition === DraftDisposition.CountingDown &&
        item.countdown !== null &&
        item.countdown.hasExpired(minute),
    )
    .map(item => item.draftId)
    .sort()
}

function stopExpiryScheduler(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer)
  expiryTimer = null
  expiryRunning = false
  expirySignature = ''
  expiryUnchangedPolls = 0
}

async function expiryTick(): Promise<void> {
  expiryTimer = null
  const issuedInEpoch = epoch
  await refetch()
  if (!expiryRunning || issuedInEpoch !== epoch) return
  const expired = expiredCountingDownDraftIds()
  if (expired.length === 0) {
    stopExpiryScheduler()
    return
  }
  const signature = expired.join('|')
  expiryUnchangedPolls = signature === expirySignature ? expiryUnchangedPolls + 1 : 0
  expirySignature = signature
  const step = Math.min(
    Math.floor(expiryUnchangedPolls / EXPIRY_POLLS_PER_STEP),
    EXPIRY_POLL_INTERVALS_MS.length - 1,
  )
  expiryTimer = setTimeout(() => void expiryTick(), EXPIRY_POLL_INTERVALS_MS[step])
}

/**
 * Nudges the shared expiry scheduler: a countdown reached 0, so the server's verdict must be
 * pulled. IDEMPOTENT - if the scheduler is already running this is a no-op, so N expired drafts
 * (N drivers) produce one GET and one poll loop. Live mode only (the caller guards on that).
 */
function requestExpiryRefresh(): void {
  if (expiryRunning) return
  expiryRunning = true
  void expiryTick()
}

/**
 * Reconciles one pushed `ReviewItemChanged` payload into the snapshot (see the
 * module header for the by-draftId/disposition rule). A malformed payload is
 * dropped.
 */
function reconcile(payload: unknown): void {
  if (!isWireReviewItem(payload)) return
  const item = toEngineReviewItem(payload)
  version += 1
  const index = items.findIndex(existing => existing.draftId === item.draftId)

  if (isResolved(item.disposition)) {
    if (index === -1) return
    items = items.filter(existing => existing.draftId !== item.draftId)
    notify()
    return
  }

  if (index === -1) {
    items = [...items, item]
  } else {
    const next = [...items]
    next[index] = item
    items = next
  }
  notify()
}

/**
 * Optimistically removes `draftId` from the local snapshot right after firing
 * an approve/edit/veto/batch-approve POST — the item just resolved
 * (published/vetoed), so it leaves the queue immediately rather than waiting
 * on the `ReviewItemChanged` round trip. A no-op if already absent.
 */
function removeItemOptimistically(draftId: string): void {
  if (!items.some(item => item.draftId === draftId)) return
  version += 1
  items = items.filter(item => item.draftId !== draftId)
  notify()
}

/**
 * Starts the live data source: the initial GET plus the `ReviewItemChanged`
 * subscription over the shared connection, with a reconnect-triggered resync.
 * Idempotent — a second call (e.g. a second `<ReviewQueue>` mount) is a no-op.
 */
function ensureStarted(connection: RealtimeConnection = realtimeConnection): void {
  if (started) return
  started = true
  attachedConnection = connection

  unsubscribePush = connection.subscribe(REVIEW_ITEM_CHANGED_EVENT, payload => reconcile(payload))
  unsubscribeState = connection.onStateChange(state => {
    if (state === HubConnectionState.Connected) void refetch({ invalidate: true })
  })

  void refetch()
  void connection.start().catch(() => {
    // Hub unreachable — the GET above still seeded the snapshot; a later
    // reconnect (onStateChange → Connected) resyncs via refetch().
  })
}

/** Drops the push and connection-state subscriptions and marks the store not started. */
function detach(): void {
  if (unsubscribePush !== null) unsubscribePush()
  if (unsubscribeState !== null) unsubscribeState()
  unsubscribePush = null
  unsubscribeState = null
  started = false
}

/**
 * The session is ending (sign-out, or a sign-in replacing this identity): forget everything
 * that belonged to it. See the module header ("THE SESSION ENDS"). Registered below with
 * `core/auth/sessionReset`; synchronous and never throws.
 */
function resetForSession(): void {
  const stillMounted = listeners.size > 0
  const connection = attachedConnection
  detach()
  epoch += 1
  version += 1
  inFlight = null
  trailingRequested = false
  clearReconcile()
  stopExpiryScheduler()
  if (items.length > 0) {
    items = []
    notify()
  }
  if (!stillMounted) return
  // A console is still subscribed: nothing will call ensureStarted() for it again, so
  // re-attach here. A microtask later, so core/realtime's stop() (registered before this,
  // but the order is not ours to rely on) has begun; and only with a session to attach as.
  void Promise.resolve().then(() => {
    if (listeners.size > 0 && getAccessToken() !== null) ensureStarted(connection)
  })
}

/**
 * Tears the subscription down and clears the snapshot. Test-only — prevents a
 * live-mode test from leaking a subscription or stale items into the next.
 */
function resetForTests(): void {
  detach()
  attachedConnection = realtimeConnection
  epoch += 1
  version += 1
  inFlight = null
  committedSeq = 0
  getSeq = 0
  trailingRequested = false
  clearReconcile()
  stopExpiryScheduler()
  items = []
  listeners.clear()
}

/** The module-singleton live review-queue data source. See the module header. */
export const liveReviewStore = {
  getItems,
  subscribe,
  ensureStarted,
  removeItemOptimistically,
  refetch,
  requestExpiryRefresh,
  resetForTests,
}

registerSessionReset(resetForSession, import.meta.hot)
