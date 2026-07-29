/**
 * features/controller/services/liveStorylineActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE escalation-dial storyline READ/WRITE calls (feature: world-steering,
 * story 09 — "Escalation dial live"; CTL-022 / D5-014/2.2 mock->live flip,
 * COR-001). STAFF world — pure service module, no UI, no COBRA. Used ONLY when
 * `USE_MOCK_DATA` is false (`@/core/config/mockData`); `useStorylineTarget`'s
 * live branch (and `liveStorylineStore`'s poll) call these, mirroring
 * `liveEngineControlActions.ts`'s conventions:
 *
 *   - NO client `exerciseId` (COR-001) — every request carries only the
 *     storyline id in the URL; scope is resolved server-side from the
 *     session, exactly like `liveEngineControlActions`'s kill-switch POST.
 *   - AWAITED, not fire-and-forget (unlike the review actions) — the dial's
 *     optimistic local update must reconcile against the AUTHORITATIVE
 *     actual/target/phase these calls return (AC2), not trust its own guess.
 *   - Fail-closed narrowing (mirrors `liveReviewStore`'s wire validation): a
 *     malformed response body throws rather than being cast blindly, so a
 *     caller's `.catch` (not a silent bad value) handles it.
 *
 * THE "PRIMARY" SENTINEL (mirrors `MOCK_STORYLINE_ID`). Wave-1/2 has no
 * Stories board (D5-016/017, still not built) for a controller to pick a real
 * storyline id from, so `PRIMARY_STORYLINE_SENTINEL` — matching the backend's
 * `StorylineSteeringService.PrimaryStorylineSentinel` constant EXACTLY — is
 * passed until the first successful GET/POST resolves the exercise's real
 * storyline id (which the caller then uses for subsequent calls). The backend
 * compares this literal EXACTLY (Gate-1 W-001) — it resolves to the CALLER's
 * own exercise's first registered storyline; any other non-GUID literal
 * (a stray `"undefined"`, a typo, ...) 404s rather than silently wildcarding
 * to "whichever storyline is first". Exercise-scoped by construction
 * (COR-001), not a client-supplied scoping parameter.
 *
 * URL-ENCODED (Gate-1 S-002). Every storyline id — the sentinel or a real
 * GUID — is `encodeURIComponent`-ed into the request path, defence in depth
 * against a malformed/unexpected id value corrupting the route.
 *
 * BOUNDED REQUEST TIME (Gate-2 W-101). The shared `core/services/api.ts`
 * axios instance sets no default `timeout` (a wider change out of this
 * story's footprint), so a hung request here would otherwise leave the
 * dial's PENDING claim (`useStorylineTarget`'s `pendingChangeDetail`)
 * standing indefinitely with nothing to resolve it. Both calls in this file
 * set `REQUEST_TIMEOUT_MS` explicitly, scoped to just this story's requests.
 */

import { api } from '@/core/services/api'
import type { StorylinePhase } from './storylineMock'

/** Mirrors the backend's `StorylineSteeringService.PrimaryStorylineSentinel` exactly. */
export const PRIMARY_STORYLINE_SENTINEL = 'primary'

/**
 * Bounds how long a GET/POST here may hang before axios rejects it with a
 * timeout error (Gate-2 W-101) — comfortably above the `POLL_MS` cadence and
 * ordinary network latency, but never unbounded.
 */
export const REQUEST_TIMEOUT_MS = 8000

/**
 * The live actual/target/phase state — a field-for-field mirror of the
 * backend's `StorylineSteeringDto`.
 */
export interface LiveStorylineSteeringState {
  readonly storylineId: string
  /** The storyline's human title (Gate-1 W-008 — names what the dial is steering). */
  readonly title: string
  readonly exerciseId: string
  /** 0-100, clamped (`Storyline.Intensity`). */
  readonly intensity: number
  /** 0-100, or `null` when unset (`Storyline.TargetIntensity`). */
  readonly targetIntensity: number | null
  /**
   * The PascalCase `StorylinePhase` member name (e.g. `Escalating`) — see
   * `storylineMock.ts`'s `StorylinePhase`.
   */
  readonly phase: StorylinePhase
}

const KNOWN_PHASES: ReadonlySet<string> = new Set<StorylinePhase>([
  'Dormant',
  'Seeded',
  'Escalating',
  'Peak',
  'Addressed',
  'Decaying',
  'Resolved',
])

/**
 * Narrows an unknown response body to the frozen wire shape — never a blind
 * cast (COR-001 defence in depth).
 */
function isWireStorylineSteeringState(value: unknown): value is LiveStorylineSteeringState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const targetOk =
    v.targetIntensity === null || v.targetIntensity === undefined || typeof v.targetIntensity === 'number'
  return (
    typeof v.storylineId === 'string' && v.storylineId.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.exerciseId === 'string' && v.exerciseId.length > 0 &&
    typeof v.intensity === 'number' &&
    targetOk &&
    typeof v.phase === 'string' && KNOWN_PHASES.has(v.phase)
  )
}

/**
 * Projects a validated wire payload to the live state (a missing
 * `targetIntensity` defaults to `null`).
 */
function toLiveState(wire: LiveStorylineSteeringState): LiveStorylineSteeringState {
  return {
    storylineId: wire.storylineId,
    title: wire.title,
    exerciseId: wire.exerciseId,
    intensity: wire.intensity,
    targetIntensity: wire.targetIntensity ?? null,
    phase: wire.phase,
  }
}

/**
 * `GET /api/steering/storylines/{storylineId}` — the storyline's CURRENT
 * actual/target/phase, read directly off the live `Storyline` the reaction
 * loop ticks. Throws on a network failure or a malformed body (the caller —
 * `liveStorylineStore.refetch` — catches and keeps its previous snapshot).
 */
export async function getStoryline(storylineId: string): Promise<LiveStorylineSteeringState> {
  const response = await api.get<unknown>(`/steering/storylines/${encodeURIComponent(storylineId)}`, {
    timeout: REQUEST_TIMEOUT_MS,
  })
  if (!isWireStorylineSteeringState(response.data)) {
    throw new Error('Malformed GET /steering/storylines/{storylineId} response.')
  }
  return toLiveState(response.data)
}

/**
 * `POST /api/steering/storylines/{storylineId}/target` — sets (or, with
 * `target: null`, clears) the controller's dial target on the live storyline,
 * returning the updated actual/target/phase so the caller can reconcile its
 * optimistic local update against this authoritative response (AC2). Throws
 * on a network failure or a malformed body.
 */
export async function setStorylineTarget(
  storylineId: string,
  target: number | null,
): Promise<LiveStorylineSteeringState> {
  const response = await api.post<unknown>(
    `/steering/storylines/${encodeURIComponent(storylineId)}/target`,
    { target },
    { timeout: REQUEST_TIMEOUT_MS },
  )
  if (!isWireStorylineSteeringState(response.data)) {
    throw new Error('Malformed POST /steering/storylines/{storylineId}/target response.')
  }
  return toLiveState(response.data)
}
