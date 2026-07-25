/**
 * features/controller/services/livePauseTierActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE tiered-pause ACTIONS (feature: world-steering, story 07; CTL-023,
 * COR-001, COR-018). STAFF world — pure service module, no UI, no COBRA. Used
 * ONLY when `USE_MOCK_DATA` is false (`@/core/config/mockData`); `usePauseState`
 * calls this to make the pause tier SERVER-AUTHORITATIVE, mirroring
 * `liveEngineControlActions.ts`'s conventions exactly.
 *
 * THE ENDPOINT. Both calls hit the one route the backend slice maps
 * (`Pulse.WebApi/Features/EngineRuntime/Steering/PauseTierEndpoints.cs`):
 *   - `POST /api/steering/pause-tier` — records the tier for the resolved
 *     exercise and, on the `freeze` transition, calls the already-built
 *     `IExerciseClock.Freeze`/`Unfreeze`. `ReactionLoopHost` already skips a
 *     tick entirely while `IsFrozen`, so this POST is what makes Freeze
 *     genuinely halt the engine.
 *   - `GET /api/steering/pause-tier` — the console's RESYNC read, so a freshly
 *     mounted console adopts the tier the exercise is actually in rather than
 *     assuming `running`.
 *
 * NO CLIENT `exerciseId` (COR-001) — the POST body carries only `tier` +
 * `actingHumanId` + `timeZone`; scope is resolved server-side from the session,
 * exactly like `liveEngineControlActions`'s body. The GET takes no parameters
 * at all. The endpoint is gated by the SAME staff-plus-assigned-exercise filter
 * the review cockpit uses, so an unauthenticated/unscoped caller gets 401 and a
 * staff caller not assigned to the resolved exercise gets 403.
 *
 * OUTCOME-HANDLED, NOT FIRE-AND-FORGET. Like the kill switch (#337),
 * `usePauseState.setTier` attaches a `.catch(...)` to `setPauseTier` — it does
 * not block/await, but it DOES revert its optimistic tier flip on a rejection,
 * because the console must never claim WORLD FROZEN when the world is still
 * running. Both functions normalize the axios response; callers decide how to
 * handle rejection.
 *
 * NO TELEMETRY HERE (XC-004). The ONE `steering_action` event per transition is
 * emitted by `usePauseState` in BOTH modes (unchanged shape from story 03) and
 * is deliberately not duplicated by this live path or by the backend.
 */

import { api } from '@/core/services/api'
import type { PauseTier } from '../hooks/usePauseState'

/** The pause-tier request context — no client `exerciseId` (COR-001). */
export interface PauseTierActionContext {
  readonly actingHumanId: string
  readonly timeZone: string
}

/** `POST`/`GET /api/steering/pause-tier` (relative to the shared axios client's `/api` base). */
const PAUSE_TIER_PATH = '/steering/pause-tier'

/** The four wire literals the backend accepts — the frozen client union, field-for-field. */
const WIRE_TIERS: readonly PauseTier[] = ['running', 'injects', 'engine', 'freeze']

/**
 * Records `tier` as the resolved exercise's server-authoritative pause tier
 * (and freezes/unfreezes its scenario clock on the Freeze transition). Returns
 * a `Promise<void>` so the caller can revert its optimistic UI state on
 * rejection.
 */
export function setPauseTier(tier: PauseTier, ctx: PauseTierActionContext): Promise<void> {
  const { actingHumanId, timeZone } = ctx
  return api.post(PAUSE_TIER_PATH, { tier, actingHumanId, timeZone }).then(() => undefined)
}

/**
 * Reads the resolved exercise's current pause tier (the console's resync read).
 * Rejects when the response is missing or carries a tier this build does not
 * recognise — the caller then keeps its local state rather than adopting a
 * value it cannot honour.
 */
export function fetchPauseTier(): Promise<PauseTier> {
  return api.get(PAUSE_TIER_PATH).then(response => {
    const tier = (response.data as { tier?: unknown } | undefined)?.tier
    if (typeof tier !== 'string' || !WIRE_TIERS.includes(tier as PauseTier)) {
      throw new Error(`Unrecognised pause tier from /api${PAUSE_TIER_PATH}: ${String(tier)}`)
    }
    return tier as PauseTier
  })
}
