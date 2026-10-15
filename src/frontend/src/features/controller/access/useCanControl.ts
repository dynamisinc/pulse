/**
 * features/controller/access/useCanControl.ts
 * ---------------------------------------------------------------------------
 * The ONE read-only gate for the controller console (demo-feedback story 11, #507; DF-14;
 * COR-013 UI half). STAFF world, no UI.
 *
 * WHY. Seam S-3 admits the evaluator to `/staff/console` so a Fed or another lead can WATCH the
 * exercise without affecting it. Every write control in the console asks this hook and renders
 * NOTHING when it is false: absent, never disabled (a disabled control still reads as "you could,
 * if..."). Read-only surfaces (the live world, the run sheet list, the review queue cards, the
 * noise level and rate, Export posts) stay.
 *
 * THE RULE: `useOptionalSession()?.role === 'controller'`. The role is the REAL signed-in
 * session's: staff routes sit under the `SessionProvider` that `app-shell/routes.tsx` hoists
 * above the staff tree, and it renders its children only once the session is resolved, so the
 * answer never flips after the first render. NOT `useControllerIdentity().role`: that is a
 * hard-coded `'controller'` mock, so gating on it would gate nothing (implementation.md map;
 * `ExerciseLifecycleControl` follows the same rule). With no session at all it FAILS CLOSED
 * (false), and there is deliberately no prop or context to override it: a control that can be
 * told "you are a controller" can be shown to the wrong role. Tests choose the session (or mock
 * this module) instead.
 *
 * THIS HIDES CONTROLS; IT AUTHORIZES NOTHING. The API does not yet refuse an evaluator's write
 * (#61 / #377, after the demo): an evaluator with a REST client can still write.
 */

import { useOptionalSession } from '@/core/auth'

/** True only when the signed-in session's role is `controller`. */
export function useCanControl(): boolean {
  return useOptionalSession()?.role === 'controller'
}
