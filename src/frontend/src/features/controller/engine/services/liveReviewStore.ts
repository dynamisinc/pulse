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
 */

import { api } from '@/core/services/api'
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
  try {
    const response = await api.get<unknown>(REVIEW_QUEUE_PATH)
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

/**
 * Tears the subscription down and clears the snapshot. Test-only — prevents a
 * live-mode test from leaking a subscription or stale items into the next.
 */
function resetForTests(): void {
  if (unsubscribePush !== null) unsubscribePush()
  if (unsubscribeState !== null) unsubscribeState()
  unsubscribePush = null
  unsubscribeState = null
  started = false
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
