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

/**
 * Refetches the queue from the server and replaces the snapshot wholesale.
 * Fails closed (COR-001) on a request error or a malformed body by leaving the
 * PREVIOUS snapshot in place — never substitutes an empty/default queue.
 */
async function refetch(): Promise<void> {
  const issuedInEpoch = epoch
  try {
    const response = await api.get<unknown>(REVIEW_QUEUE_PATH)
    if (issuedInEpoch !== epoch) return // for an identity that has since ended
    if (!isWireReviewItemArray(response.data)) return
    items = response.data.map(toEngineReviewItem)
    notify()
  } catch {
    // Transient failure (including the expected pre-scope 401) — keep the
    // previous snapshot; the next hub reconnect retries.
  }
}

/**
 * Reconciles one pushed `ReviewItemChanged` payload into the snapshot (see the
 * module header for the by-draftId/disposition rule). A malformed payload is
 * dropped.
 */
function reconcile(payload: unknown): void {
  if (!isWireReviewItem(payload)) return
  const item = toEngineReviewItem(payload)
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
    if (state === HubConnectionState.Connected) void refetch()
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
  items = []
  listeners.clear()
}

/** The module-singleton live review-queue data source. See the module header. */
export const liveReviewStore = {
  getItems,
  subscribe,
  ensureStarted,
  removeItemOptimistically,
  resetForTests,
}

registerSessionReset(resetForSession, import.meta.hot)
