/**
 * features/controller/engine/services/liveEngineControlActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE engine kill-switch ACTIONS (feature: engine-review-cockpit,
 * ADP-042; COR-001, COR-018). STAFF world — pure service module, no UI, no
 * COBRA. Used ONLY when `USE_MOCK_DATA` is false (`@/core/config/mockData`);
 * `useEngineControl` calls this to make the always-visible LIVE /
 * SUGGEST-ONLY / STOPPED control actually reach the backend, mirroring
 * `liveReviewActions.ts`'s conventions exactly.
 *
 * MODE -> ENDPOINT MAPPING. The kill switch's three positions
 * (`EngineMode`, `../hooks/useEngineControl`) map onto the two backend
 * safety-clamp endpoints:
 *   - `'stop'`          -> `POST /api/engine/autonomy/kill-switch` with
 *     `mode: 'full-stop'` — halts generation entirely.
 *   - `'suggest-only'`  -> `POST /api/engine/autonomy/kill-switch` with
 *     `mode: 'drop-to-suggest'` — clamps every draft to Suggest (no
 *     autonomous send).
 *   - `'live'`          -> `POST /api/engine/autonomy/restore` — the ONLY way
 *     to lift the clamp back to full autonomy (mirrors "only humans raise",
 *     see the hook's module header); there is no `mode` field to restore.
 *
 * NO CLIENT `exerciseId` (COR-001) — every request carries only
 * `actingHumanId` + `timeZone`; scope is resolved server-side from the
 * session, exactly like `liveReviewActions`'s `actionBody`.
 *
 * OUTCOME-HANDLED, NOT FIRE-AND-FORGET. Unlike the review actions (which drop
 * the promise entirely), `useEngineControl.setMode` attaches a `.catch(...)`
 * handler to this promise — it does not block/await, but it DOES react to a
 * rejection by reverting its optimistic local update, because a kill switch
 * must never claim a safety state the backend didn't actually apply. `setMode`
 * here normalizes the axios response to `Promise<void>`; callers decide how to
 * handle rejection.
 */

import { api } from '@/core/services/api'
import type { EngineMode } from '../hooks/useEngineControl'

/** The kill-switch/restore request context — no client `exerciseId` (COR-001). */
export interface EngineControlActionContext {
  readonly actingHumanId: string
  readonly timeZone: string
}

/** `POST /api/engine/autonomy/kill-switch` (relative to the shared axios client's `/api` base). */
const KILL_SWITCH_PATH = '/engine/autonomy/kill-switch'

/** `POST /api/engine/autonomy/restore` — lifts the clamp back to full autonomy. */
const RESTORE_PATH = '/engine/autonomy/restore'

/**
 * Fires the backend kill switch / restore for `mode` (see the module header
 * for the mapping). Returns a `Promise<void>` so the caller can revert its
 * optimistic UI state on rejection.
 */
export function setMode(mode: EngineMode, ctx: EngineControlActionContext): Promise<void> {
  const { actingHumanId, timeZone } = ctx

  if (mode === 'live') {
    return api.post(RESTORE_PATH, { actingHumanId, timeZone }).then(() => undefined)
  }

  const killSwitchMode = mode === 'stop' ? 'full-stop' : 'drop-to-suggest'
  return api
    .post(KILL_SWITCH_PATH, { actingHumanId, timeZone, mode: killSwitchMode })
    .then(() => undefined)
}
