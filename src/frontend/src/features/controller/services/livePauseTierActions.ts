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
 * `actingHumanId` + `timeZone` + `overlayRegister`; scope is resolved
 * server-side from the session, exactly like `liveEngineControlActions`'s body.
 * The GET takes no parameters at all. The endpoint is gated by the SAME
 * staff-plus-assigned-exercise filter the review cockpit uses, so an
 * unauthenticated/unscoped caller gets 401 and a staff caller not assigned to
 * the resolved exercise gets 403.
 *
 * `overlayRegister` (world-steering story 08) is the console's selected
 * participant-overlay register — a PRESENTATION choice, legitimately
 * client-supplied exactly like `tier`, and validated server-side (anything but
 * `'in-fiction'` is coerced to `'out-of-fiction'`, the conservative default). It
 * decides which holding page a Freeze shows participants — "We'll be right back"
 * vs "EXERCISE PAUSED" — and influences nothing else: never the scope, the tier,
 * or the scenario clock.
 *
 * OUTCOME-HANDLED, NOT FIRE-AND-FORGET. Like the kill switch (#337),
 * `usePauseState.setTier` attaches handlers to `setPauseTier` — it does not
 * block/await, but it DOES revert its optimistic tier flip when the call fails,
 * because the console must never claim WORLD FROZEN when the world is still
 * running.
 *
 * BOTH CALLS RETURN THE SERVER'S STATE, NOT `void`. The endpoint answers with
 * `{ tier, clockFrozen }`, where `clockFrozen` is read off the native clock
 * itself — so a Freeze that could not reach the clock is visible as
 * `clockFrozen: false` (and a refused freeze is a `409`, which rejects). Throwing
 * that body away would reintroduce exactly the failure this story exists to
 * eliminate: a control reporting a state the server never applied. The caller
 * VERIFIES the returned state against what it optimistically rendered and
 * reverts on a mismatch.
 *
 * NO TELEMETRY HERE (XC-004). The ONE `steering_action` event per transition is
 * emitted by `usePauseState` in BOTH modes (unchanged shape from story 03) and
 * is deliberately not duplicated by this live path or by the backend.
 */

import { api } from '@/core/services/api'
import type { OverlayRegister, PauseTier } from '../hooks/usePauseState'

/** The pause-tier request context — no client `exerciseId` (COR-001). */
export interface PauseTierActionContext {
  readonly actingHumanId: string
  readonly timeZone: string
  /**
   * The console's selected participant-overlay register (story 08) — which
   * holding page a Freeze shows participants. Presentation only; validated
   * server-side (see the module header).
   */
  readonly overlayRegister: OverlayRegister
}

/** `POST`/`GET /api/steering/pause-tier` (relative to the shared axios client's `/api` base). */
const PAUSE_TIER_PATH = '/steering/pause-tier'

/** The four wire literals the backend accepts — the frozen client union, field-for-field. */
const WIRE_TIERS: readonly PauseTier[] = ['running', 'injects', 'engine', 'freeze']

/**
 * The server's authoritative pause state — the staff-only `PauseTierStateDto`
 * shape, field-for-field.
 */
export interface PauseTierServerState {
  /** The tier the server has recorded for the resolved exercise. */
  readonly tier: PauseTier
  /**
   * Whether the exercise's scenario clock is ACTUALLY frozen, read off the
   * native clock — the truth signal the console checks before it dares render
   * WORLD FROZEN.
   */
  readonly clockFrozen: boolean
}

/** Parses + validates the wire body; rejects anything this build cannot honour. */
function parseState(data: unknown): PauseTierServerState {
  const body = data as { tier?: unknown; clockFrozen?: unknown } | undefined
  const tier = body?.tier
  if (typeof tier !== 'string' || !WIRE_TIERS.includes(tier as PauseTier)) {
    throw new Error(`Unrecognised pause tier from /api${PAUSE_TIER_PATH}: ${String(tier)}`)
  }
  return { tier: tier as PauseTier, clockFrozen: body?.clockFrozen === true }
}

/**
 * Records `tier` as the resolved exercise's server-authoritative pause tier
 * (starting then freezing / unfreezing its scenario clock on the Freeze
 * transition). Resolves with the server's resulting state so the caller can
 * VERIFY it, and rejects (e.g. the `409` a freeze that could not reach the clock
 * returns) so the caller can revert its optimistic UI state.
 */
export function setPauseTier(
  tier: PauseTier,
  ctx: PauseTierActionContext,
): Promise<PauseTierServerState> {
  const { actingHumanId, timeZone, overlayRegister } = ctx
  return api
    .post(PAUSE_TIER_PATH, { tier, actingHumanId, timeZone, overlayRegister })
    .then(response => parseState(response.data))
}

/**
 * Reads the resolved exercise's current pause state (the console's resync read).
 * Rejects when the response is missing or carries a tier this build does not
 * recognise — the caller then keeps its local state rather than adopting a
 * value it cannot honour.
 */
export function fetchPauseTier(): Promise<PauseTierServerState> {
  return api.get(PAUSE_TIER_PATH).then(response => parseState(response.data))
}
