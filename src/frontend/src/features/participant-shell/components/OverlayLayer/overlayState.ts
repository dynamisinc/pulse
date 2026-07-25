/**
 * features/participant-shell/components/OverlayLayer/overlayState.ts
 * ---------------------------------------------------------------------------
 * The overlay-state mock seam (feature: participant-shell, story 05; COR-065,
 * XC-001; see docs/features/participant-shell/05-overlay-layer.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §3).
 *
 * Mirrors `../../shellState.ts` / `../../chromeConfig.ts`'s "mock behind the
 * shared axios client" pattern exactly: every request routes through `api` so
 * the request shape (method, URL, base URL, headers) matches the future
 * `/overlay-state` endpoint, with mock data swapped at exactly ONE
 * env-guarded flip point (WAVE0-REVIEW precedent 15) rather than per call —
 * a production build without a backend fails CLOSED (the query errors;
 * `useOverlayState()` falls back to the safe `'none'` default below, it never
 * invents or serves stale overlay content).
 *
 * Eventual transport (CLAUDE.md §G): overlay pushes are server state that
 * will ultimately arrive over the shared SignalR connection (one connection,
 * new handlers added to it) rather than polling — the real-time work is out
 * of scope for this story. This Wave-1 mock uses the same React-Query-behind-
 * axios seam as the rest of the shell so the query/cache/consumer shape is
 * already correct; only `fetchOverlayState`'s transport changes when that
 * lands, not `useOverlayState()`'s return contract.
 *
 * ## THE LIVE BRANCH LANDED (world-steering story 08; CTL-023, D5-014/1.3)
 * That "eventual transport" is now here, behind the ONE `USE_MOCK_DATA` flag
 * (mirroring `useReviewQueue`'s split — WAVE0-REVIEW precedent 15):
 *   - **mock** (dev/UAT, and every story-05 test): UNCHANGED — the React Query
 *     read below, resolved by the canned `mockAdapter`.
 *   - **live** (`USE_MOCK_DATA === false`): `liveOverlayStateStore` — an
 *     initial `GET /api/overlay-state` (which now serves the real per-exercise
 *     state a controller's Freeze wrote, not a hardcoded `'none'`) plus the
 *     `OverlayStateChanged` push on the SAME shared `core/realtime` connection
 *     (`/hubs/exercise`) the participant feed and the review cockpit already
 *     use. NO second connection is opened.
 *
 * `useOverlayState()`'s public contract (`{state, register, message}`) is
 * UNCHANGED — only its data source flips — so `OverlayLayer.tsx` needs (and
 * gets) no change at all: this is data plumbing into an already-working
 * consumer, which is why a Freeze now shows the holding page it already knew
 * how to render.
 *
 * RESILIENCE — "GET seeds, push updates, reconnect re-GETs" (mirrors
 * `liveReviewStore.ts`): the initial GET seeds the snapshot so a participant
 * who joins or refreshes MID-Freeze still lands on the holding page; pushes
 * update it live; a hub reconnect (including the first connect) re-GETs the
 * authoritative state, so nothing missed while disconnected is stranded. A
 * malformed push is DROPPED, never cast blindly, and a push that is OLDER than
 * what we have already applied is dropped too — the server publishes a
 * per-exercise monotonic `sequence` precisely so a late out-of-order push cannot
 * re-show a holding page over a world the controller has already resumed.
 *
 * NOTHING HERE TRUSTS ARRIVAL ORDER (CR-001). Two seed GETs race on every
 * startup — `ensureStarted` issues one and `connection.start()`'s `Connected`
 * transition fires the resync listener — and a push can land while a GET is in
 * flight. So every GET carries a generation + a push-count watermark taken when
 * it was ISSUED and is discarded if either moved (see `refetchLive`); otherwise
 * an older body could not only show the wrong page but REWIND the stale-push
 * cutoff below a push that has already been consumed and can never be replayed,
 * leaving a participant with no holding page over a frozen world until the next
 * transition.
 *
 * This story owns the TYPES (`./types.ts`) and this resolution seam. It does
 * NOT build the triggers that set overlay state server-side — Break Fiction's
 * guarded control (world-steering #27) is still out of scope (STORY-UPDATES
 * §B); tiered pause's server-authoritative write path (world-steering #26/07)
 * is what the live branch above now reads.
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId`, read from `useExerciseContext()` for KEYING only
 * (WAVE0-REVIEW precedent 13) — never sent to the server as a client-supplied
 * scoping parameter (the mock ignores it entirely; a real endpoint scopes by
 * the authenticated session, server-side).
 *
 * Uses React Query — this is cacheable shell state, exactly like
 * `shellState.ts`/`chromeConfig.ts` (contrast `core/exerciseContext`'s
 * deliberately hand-rolled fail-closed gate, WAVE0-REVIEW precedent 16).
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'
import type { OverlayRegister, OverlayState, OverlayStateKind } from './types'

/** `GET /api/overlay-state` (relative to the shared axios client's `/api` base). */
const OVERLAY_STATE_PATH = '/overlay-state'

/** The SignalR client event the backend's pause-overlay publisher pushes on. */
const OVERLAY_STATE_CHANGED_EVENT = 'OverlayStateChanged'

/** Wire shape of the (future) `/overlay-state` response body. */
type OverlayStateResponseBody = OverlayState

/**
 * All valid overlay states / registers. The runtime guards check membership
 * here so they match the wire contract — this seam swaps to a live endpoint
 * with no consumer change, so an out-of-enum value must fail closed, not be
 * cast blindly.
 */
const VALID_OVERLAY_STATE_KINDS: readonly OverlayStateKind[] = [
  'none',
  'pause',
  'endex',
  'broadcast',
]
const VALID_OVERLAY_REGISTERS: readonly OverlayRegister[] = ['in-fiction', 'out-of-fiction']

function isOverlayStateKind(value: unknown): value is OverlayStateKind {
  return typeof value === 'string' && (VALID_OVERLAY_STATE_KINDS as readonly string[]).includes(value)
}

function isOverlayRegister(value: unknown): value is OverlayRegister {
  return typeof value === 'string' && (VALID_OVERLAY_REGISTERS as readonly string[]).includes(value)
}

function isValidResponseBody(
  body: OverlayStateResponseBody | null | undefined,
): body is OverlayStateResponseBody {
  return (
    !!body &&
    isOverlayStateKind(body.state) &&
    isOverlayRegister(body.register) &&
    typeof body.message === 'string'
  )
}

/**
 * The safe fixed mock this Wave-1 seam resolves to (dev/test only — see
 * `USE_MOCK_OVERLAY_STATE`): no overlay active. This story renders mock
 * overlay state; it does not build a trigger UI to flip it (see module
 * header) — exercising the `'pause'`/`'endex'`/`'broadcast'` branches is a
 * test-time concern (mocking `useOverlayState` at the module boundary).
 */
const MOCK_OVERLAY_STATE: OverlayStateResponseBody = {
  state: 'none',
  register: 'in-fiction',
  message: '',
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_OVERLAY_STATE,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `shellState.ts`'s `USE_MOCK_SHELL_STATE`. Mock in dev/test; a production
 * build without a backend fails closed (the query errors rather than serving
 * a canned state).
 */
const USE_MOCK_OVERLAY_STATE = USE_MOCK_DATA

async function fetchOverlayState(): Promise<OverlayState> {
  const response = await api.get<OverlayStateResponseBody>(
    OVERLAY_STATE_PATH,
    USE_MOCK_OVERLAY_STATE ? { adapter: mockAdapter } : undefined,
  )

  if (!isValidResponseBody(response.data)) {
    throw new Error(
      'fetchOverlayState: mock resolution returned a missing or invalid overlay state',
    )
  }

  return {
    state: response.data.state,
    register: response.data.register,
    message: response.data.message,
  }
}

/**
 * The safe default `useOverlayState()` falls back to whenever the query has
 * no resolved data yet — while loading, on error, or absent: no overlay,
 * `'in-fiction'` register, no message. A channel/shell must never be blocked
 * from rendering because this query hasn't resolved, and it must never
 * default to SHOWING an overlay it wasn't told to show.
 */
const DEFAULT_OVERLAY_STATE: OverlayState = {
  state: 'none',
  register: 'in-fiction',
  message: '',
}

// ---------------------------------------------------------------------------
// The LIVE data source (world-steering story 08) — module singleton, mirroring
// `liveReviewStore.ts`'s ensureStarted/subscribe/reconcile/resetForTests shape
// ---------------------------------------------------------------------------

/**
 * The wire body of `GET /api/overlay-state` and of an `OverlayStateChanged`
 * push: the frozen `OverlayState` triple plus the server's additive, opaque
 * `sequence` (see the module header's resilience note). `sequence` is optional
 * so a response that predates it — or the backend's own pre-wiring fallback
 * body — is still accepted rather than dropped as malformed.
 */
interface WireOverlayState {
  readonly state: OverlayStateKind
  readonly register: OverlayRegister
  readonly message: string
  readonly sequence?: number
}

/**
 * Fail-closed narrowing of anything the transport hands us (a push payload is
 * untyped at the transport layer) — never a blind cast. Mirrors
 * `liveReviewStore.ts`'s `isWireReviewItem`, and reuses the very same
 * enum-membership guards the mock branch validates with, so both transports
 * enforce one contract.
 */
function isWireOverlayState(value: unknown): value is WireOverlayState {
  if (typeof value !== 'object' || value === null) return false
  const wire = value as Record<string, unknown>
  return (
    isOverlayStateKind(wire.state) &&
    isOverlayRegister(wire.register) &&
    typeof wire.message === 'string'
  )
}

/** The wire `sequence`, or 0 when absent/not a finite number (see `WireOverlayState`). */
function readSequence(wire: WireOverlayState): number {
  return typeof wire.sequence === 'number' && Number.isFinite(wire.sequence) ? wire.sequence : 0
}

function toOverlayState(wire: WireOverlayState): OverlayState {
  return { state: wire.state, register: wire.register, message: wire.message }
}

/** The current live snapshot. Starts at the safe `'none'` default (fail closed). */
let liveSnapshot: OverlayState = DEFAULT_OVERLAY_STATE

/** The `sequence` of the most recently applied state — the stale-push cutoff. */
let lastAppliedSequence = 0

/**
 * Bumped for every GET *issued*, so a response can tell whether a newer GET has
 * since been issued and it is therefore stale. Production really does run two
 * concurrent seed GETs — `ensureStartedLive` fires one directly and
 * `connection.start()` emits `Connected`, which fires the resync listener — and
 * HTTP gives no response-ordering guarantee, so arrival order must not be
 * trusted (CR-001).
 */
let fetchGeneration = 0

/**
 * How many pushes have been APPLIED. Captured when a GET is issued and compared
 * when it resolves: a push that landed mid-flight is strictly more recent than
 * that GET's body (the server writes its store BEFORE it pushes), so the GET is
 * dropped rather than allowed to rewind the state — and, critically, rather than
 * allowed to rewind `lastAppliedSequence` below a push that has already been
 * consumed and can never be replayed.
 */
let appliedPushCount = 0

const liveListeners = new Set<() => void>()

let liveStarted = false
let unsubscribePush: (() => void) | null = null
let unsubscribeConnectionState: (() => void) | null = null

function notifyLive(): void {
  for (const listener of liveListeners) listener()
}

/** Returns the live snapshot. Stable reference until the next change. */
function getLiveSnapshot(): OverlayState {
  return liveSnapshot
}

/** Subscribes to live-snapshot changes; returns an unsubscribe function. */
function subscribeLive(listener: () => void): () => void {
  liveListeners.add(listener)
  return () => {
    liveListeners.delete(listener)
  }
}

/**
 * Adopts `next` and moves the stale-push cutoff to `sequence`. Notifies only on
 * a real change, so an idempotent re-GET (the reconnect resync) does not churn
 * every subscriber.
 */
function applyLive(next: OverlayState, sequence: number): void {
  lastAppliedSequence = sequence
  if (
    next.state === liveSnapshot.state &&
    next.register === liveSnapshot.register &&
    next.message === liveSnapshot.message
  ) {
    return
  }
  liveSnapshot = next
  notifyLive()
}

/**
 * Re-reads the authoritative state from `GET /api/overlay-state` — the seed on
 * start and the resync on every (re)connect. The GET is GROUND TRUTH for the
 * SEQUENCE BASELINE as well as the state: adopting it re-bases
 * `lastAppliedSequence`, so a server restart (which restarts the per-exercise
 * sequence counter) can never leave a client permanently dropping every later
 * push.
 *
 * Because it re-bases, it is ORDERING-GUARDED (CR-001) — a response is dropped
 * when either:
 *   - a NEWER GET has since been issued (`fetchGeneration`): two seed GETs really
 *     do race on every startup, and adopting the older body would show a pause
 *     state the server is not in; or
 *   - a push has been applied since this GET was issued (`appliedPushCount`): the
 *     server writes its overlay store BEFORE it broadcasts, so any push is
 *     strictly more recent than an in-flight GET's body.
 * A stale response is therefore discarded whole — never partially adopted, and
 * never allowed to rewind the cutoff below an already-consumed push.
 *
 * A failed/malformed read leaves the previous snapshot in place — never a guessed
 * or invented overlay — and the next reconnect retries.
 */
async function refetchLive(): Promise<void> {
  const generation = ++fetchGeneration
  const pushesWhenIssued = appliedPushCount

  try {
    const response = await api.get<unknown>(OVERLAY_STATE_PATH)

    // Superseded by a newer GET, or overtaken by a push — either way this body is
    // no longer the freshest thing we know. Dropping it is safe: the newer GET
    // adopts its own body, and a push has already been applied.
    if (generation !== fetchGeneration || appliedPushCount !== pushesWhenIssued) return

    if (!isWireOverlayState(response.data)) return
    applyLive(toOverlayState(response.data), readSequence(response.data))
  } catch {
    // Transient failure (including a fail-closed 401 on an unresolved scope) —
    // keep the previous snapshot; the next reconnect resyncs.
  }
}

/**
 * Reconciles one pushed `OverlayStateChanged` payload. A malformed payload is
 * dropped; so is one whose `sequence` is not NEWER than what we have already
 * applied (the out-of-order guard — see the module header).
 *
 * SG-002: an UNORDERABLE push — one with no (or a non-numeric) `sequence` — is
 * treated as malformed and dropped. The server stamps a sequence on every push;
 * only the GET fallback body served before the overlay slice is wired legitimately
 * lacks one, so tolerating a sequence-less PUSH would just be a hole in the stale
 * check.
 */
function reconcileLive(payload: unknown): void {
  if (!isWireOverlayState(payload)) return
  const sequence = readSequence(payload)
  if (sequence === 0 || sequence <= lastAppliedSequence) return

  applyLive(toOverlayState(payload), sequence)
  appliedPushCount += 1
}

/**
 * Starts the live source: the seeding GET plus the `OverlayStateChanged`
 * subscription on the SHARED realtime connection, with a reconnect-triggered
 * resync. Idempotent — the shell may mount `<OverlayLayer />` from more than
 * one place, and only one GET/subscription should result.
 */
function ensureStartedLive(connection: RealtimeConnection = realtimeConnection): void {
  if (liveStarted) return
  liveStarted = true

  unsubscribePush = connection.subscribe(
    OVERLAY_STATE_CHANGED_EVENT,
    payload => reconcileLive(payload),
  )
  unsubscribeConnectionState = connection.onStateChange(state => {
    if (state === HubConnectionState.Connected) void refetchLive()
  })

  void refetchLive()
  void connection.start().catch(() => {
    // Hub unreachable — the GET above still seeded the snapshot, and a later
    // reconnect (onStateChange → Connected) resyncs via refetchLive().
  })
}

/** Tears the subscription down and clears the snapshot. Test-only. */
function resetLiveForTests(): void {
  if (unsubscribePush !== null) unsubscribePush()
  if (unsubscribeConnectionState !== null) unsubscribeConnectionState()
  unsubscribePush = null
  unsubscribeConnectionState = null
  liveStarted = false
  liveSnapshot = DEFAULT_OVERLAY_STATE
  lastAppliedSequence = 0
  fetchGeneration = 0
  appliedPushCount = 0
  liveListeners.clear()
}

/**
 * The module-singleton LIVE overlay-state source (see the module header). One
 * per runtime, like `liveReviewStore` — a participant tab is one session in one
 * host-resolved exercise, and both the GET and the hub group are scoped
 * SERVER-side (COR-001), never by anything this module sends.
 */
export const liveOverlayStateStore = {
  getSnapshot: getLiveSnapshot,
  subscribe: subscribeLive,
  ensureStarted: ensureStartedLive,
  resetForTests: resetLiveForTests,
}

/**
 * Resolves the current exercise's overlay state (`OverlayLayer.tsx`'s sole
 * data dependency — see that module for the self-contained mount contract).
 *
 * The PUBLIC CONTRACT is unchanged by story 08's live branch: only the data
 * source flips behind `USE_MOCK_DATA` (mock = the React Query read below;
 * live = `liveOverlayStateStore`'s GET + `OverlayStateChanged` push). Both
 * branches fall back to `DEFAULT_OVERLAY_STATE` (`'none'`) until real state
 * resolves, so the overlay layer never renders against a partial value and
 * never fails OPEN into showing an overlay nobody triggered.
 *
 * Exercise-scoped: the React Query key includes `exerciseId` for KEYING only
 * (precedent 13), and the live branch's scope is resolved entirely SERVER-side
 * (the session/host-resolved exercise gates both the GET and the hub group,
 * COR-001) — this module never sends an exercise id.
 */
export function useOverlayState(): OverlayState {
  const { exerciseId } = useExerciseContext()

  // Live path only: kick off the seeding GET + the realtime subscription once
  // (idempotent — see `ensureStartedLive`). No-op under mock data.
  useEffect(() => {
    if (!USE_MOCK_DATA) liveOverlayStateStore.ensureStarted()
  }, [])

  const live = useSyncExternalStore(
    liveOverlayStateStore.subscribe,
    liveOverlayStateStore.getSnapshot,
    liveOverlayStateStore.getSnapshot,
  )

  const { data } = useQuery({
    queryKey: ['participant-shell', 'overlay-state', exerciseId],
    queryFn: fetchOverlayState,
    enabled: USE_MOCK_DATA,
  })

  return USE_MOCK_DATA ? data ?? DEFAULT_OVERLAY_STATE : live
}
