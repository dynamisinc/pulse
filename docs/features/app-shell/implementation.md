# Implementation: App shell & role-aware navigation

> Single-story feature (**single wave**), but with a hard dependency on B2's live identity seams. Pure
> frontend routing glue: it consumes the flipped `useSession`/`useExerciseContext` seams and the
> `StaffAssignment` endpoint, composes the participant guard + staff switcher (owned by
> `exercise-isolation/04` and `05`), and mounts the already-built per-world surfaces. Its one composition-
> root edit — the `App.tsx` route-table swap — is orchestrator-owned.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Role-aware global nav | A `RoleAwareEntry` reads `useSession()`/`useRole()`/`useExerciseContext()` and branches: participant/PIO → the participant landing (via `exercise-isolation/04`'s guard) mounting `ParticipantShellRoute`; staff → the console/evaluator surfaces + the switcher (`exercise-isolation/05`); unresolved/expired → fail-closed to login. Owns the route-table contribution that replaces the five flat routes; the actual `App.tsx` edit is orchestrator-owned. | `src/frontend/src/features/app-shell/RoleAwareEntry.tsx` (+ `routes.tsx` route config it exports for `App.tsx`) | `RoleAwareEntry`, the route table (consumed by the orchestrator in `App.tsx`) |

## Reuse map
<The modules this feature must reuse rather than reinvent — it is a **consumer** of B2's seams, not a builder of them.>

- **Live frozen frontend seams (flipped in B2 — consume, do not re-create):**
  - `src/frontend/src/core/auth/session.tsx` — `SessionProvider` / `useSession()` (live via
    identity-auth-roles/03's `/api/session`).
  - `src/frontend/src/core/auth/roles.ts` — `useRole()` / `ExerciseRole` / `isStaffRole` /
    `isParticipantRole`.
  - `src/frontend/src/core/exerciseContext/exerciseContext.tsx` — `ExerciseContextProvider` /
    `useExerciseContext()` (live via exercise-isolation/08's `/api/exercise-context`).
- **Composed stories (import their exports; do not rebuild):** `exercise-isolation/04` (participant
  landing route guard), `exercise-isolation/05` (`ExerciseSwitcher`, fed by
  `GET /api/staff/assignments`, identity-auth-roles/05).
- **Existing mounted surfaces (reference-mount, already built):** `features/participant-shell`
  (`ParticipantShellRoute` composition in `App.tsx`), `features/staffShell/StaffShellFrame`,
  `features/controller` (`ControllerConsoleRoute`), `features/evaluator` (`EvaluatorDashboardRoute`).
- COBRA theme + `@/theme/styledComponents` (staff chrome only) — `src/frontend/src/theme/`.
- Brand-theme provider for participant skins — `features/participant-shell/BrandThemeProvider` (mounted
  by `ParticipantShellRoute`, never by the nav directly).
- FontAwesome icons via `@fortawesome/react-fontawesome`; React Router 7 (`createBrowserRouter`).
- Shared axios client — `src/frontend/src/core/services/api.ts` (only indirectly, via the seams above).

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Role-aware global nav | frontend | `features/app-shell/RoleAwareEntry.tsx`, `features/app-shell/routes.tsx` | live `useSession` (identity/03), live `useExerciseContext` (isolation/08), `StaffAssignment` (identity/05); composes `exercise-isolation/04` + `05` (contract-first imports) | `exercise-isolation/04`, `exercise-isolation/05` (file-disjoint — this owns `features/app-shell/*`, 04 owns the participant guard, 05 owns `ExerciseSwitcher.tsx`) | 4 | M |

`04` and `05` provide the guard and the switcher as contract-first component seams; `app-shell/01`
imports and composes them. All three are file-disjoint, so they fan out in the same wave; the nav's
consumption of `04`/`05` is a contract-first import (their exported component signatures), and the actual
wiring into the app happens in the orchestrator-owned `App.tsx` edit after all three merge.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Frontend composition root | `src/frontend/src/App.tsx` | The **route-table swap**: replace the five flat routes (`/`, `/evaluator`, `/console`, `/shell`, `*`) with the `RoleAwareEntry`-driven route config `app-shell/01` exports, mounting the participant guard (04) and staff switcher (05). Orchestrator-only, serial, after the wave's builder branches merge clean. No builder branch edits `App.tsx`. |
| Mock→live flip (upstream) | `core/auth/sessionResolver.ts` (`USE_MOCK_SESSION`), `core/exerciseContext/exerciseContextResolver.ts` (`USE_MOCK_EXERCISE_CONTEXT`) | Flipped by identity-auth-roles/03 and exercise-isolation/08 respectively (their Integration seams). `app-shell/01` assumes them live; it does not own the flip. |
