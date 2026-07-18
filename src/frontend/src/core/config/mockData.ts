/**
 * core/config/mockData.ts
 * ---------------------------------------------------------------------------
 * The ONE place that decides whether this build serves mock data in place of a
 * real backend. Every mock/live flip point across the app (the exercise-context
 * resolver, shell state, session, chrome/brand/channel config, alerts, overlay
 * state, personas — "WAVE0-REVIEW precedent 15") delegates to `USE_MOCK_DATA`
 * so the rule lives in exactly one auditable spot.
 *
 * `USE_MOCK_DATA` is true when EITHER:
 *   - this is a Vite dev build (`import.meta.env.DEV`), so `npm run dev` always
 *     runs on mock data; or
 *   - the build was explicitly opted in with `VITE_USE_MOCK_DATA=true`.
 *
 * The explicit flag exists so a *production* build with no backend — today, the
 * UAT Static Web App — can be deliberately told to run on mock data instead of
 * failing closed to blank surfaces.
 *
 * OPT-IN BY CONSTRUCTION (COR-001). The absence of the flag never enables mock
 * data: a real participant-facing deploy that simply omits `VITE_USE_MOCK_DATA`
 * fails closed rather than silently serving canned exercise data. Only an
 * explicit `=true` flips it on. NEVER set that flag in a participant-facing
 * production environment.
 */

/**
 * Whether the frontend should serve mock data instead of calling a real
 * backend. See the module header for the fail-closed rationale.
 */
export const USE_MOCK_DATA: boolean =
  import.meta.env.DEV || import.meta.env.VITE_USE_MOCK_DATA === 'true'

/**
 * Emits a loud, one-time console warning when mock data is active in a
 * *production* build (i.e. via `VITE_USE_MOCK_DATA`, not the expected dev
 * server). Called once at startup from `main.tsx`. Keeps a backend-less UAT
 * from ever being mistaken for a real, backed environment.
 */
export function warnIfMockDataActive(): void {
  if (USE_MOCK_DATA && !import.meta.env.DEV) {
    console.warn(
      '[mock-data] Mock data is ON in a production build (VITE_USE_MOCK_DATA=true). ' +
      'Every surface is served from CANNED data, not a real backend — this must ' +
      'NEVER be enabled in a participant-facing deploy (COR-001).',
    )
  }
}
