# features/staff (STAFF world — COBRA)

Staff-console cross-exercise surfaces for Pulse. **This is the staff world (D0 §2):**
COBRA look via `@/theme/styledComponents`-adjacent tokens (`CobraStyles`), FontAwesome
icons only, MUI system props through `sx` (MUI 9). It must never read as a participant
skin, and it never mounts a participant/brand theme.

## The staff route registry — `staffRouteRegistry.tsx`

**The one place a staff surface is declared.** `App.tsx` injects
`STAFF_ROUTE_REGISTRY` into `RoleAwareEntry`, which (for a resolved staff role only)
hands it to `StaffRouteTree` — see
[`features/app-shell/README.md`](../app-shell/README.md) for the two-layer routing model
and the COR-004 guarantee that keeps participants off these URLs entirely.

| Entry field | Meaning |
|-------------|---------|
| `id` | Stable machine id — focus keys, telemetry, launcher keys. Never displayed. |
| `path` | The deep link. Must start `/staff/`; must not be `/staff/login`. |
| `label` | Launcher item **and** the focus-scope label. |
| `icon` | FontAwesome `IconDefinition` (never `@mui/icons-material`). |
| `element` | The route composition, owned by the surface's own feature. |
| `allowedRoles` | The **single** gate — routing today, launcher visibility later. |
| `group` | Launcher section: `plan` / `conduct` / `evaluate` / `administer`. |
| `isDefaultFor?` | Roles that land here for a bare `/staff`, an unknown path, or a path they may not open. Must be ⊆ `allowedRoles`; exactly one entry per role. |
| `description?` | One line of launcher copy. No routing meaning. |

Shipped paths: `/staff/plan` (planner), `/staff/console` (controller), `/staff/evaluate`
(evaluator). **Adding surface #4** = build its route composition in its own feature,
export it, add one entry. No routing-glue edit — `staffRouteRegistry.test.tsx` asserts the
table's invariants and `features/app-shell/registryIsTheOnlySeam.test.ts` asserts the glue
never names a surface.

The route compositions themselves live with their features
(`@/features/controller`, `@/features/evaluator`, `@/features/planner`) so the registry can
import them without an `App.tsx` cycle. `element` is a `ReactNode`, so a future
code-split surface simply declares
`element: <Suspense fallback={…}><LazyFoo /></Suspense>` — no shape change.

## Story 05 — Staff cross-exercise switcher (COR-005, D5-012(g))

The **pre-conduct exercise switcher** a controller/evaluator/planner uses to pick which
of their assigned exercises their staff session is scoped to.

| File | Role |
|------|------|
| `components/ExerciseSwitcher.tsx` | The COBRA switcher: lists assignments, highlights the active one (icon + text + color, never color alone), lets the caller pick a different exercise. |
| `hooks/useStaffAssignments.ts` | React Query 5 query wrapping the assignment-list read. |
| `hooks/useSetActiveExercise.ts` | React Query 5 mutation wrapping the switch; invalidates the query cache on success. |
| `services/staffAssignmentsService.ts` | The data seam. Routes through the shared axios client with a mock adapter behind `USE_MOCK_DATA` (one env-guarded flip point); validates response bodies fail-closed; throws a transport-agnostic `StaffAssignmentError`. |
| `types.ts` | The `StaffAssignment` client contract (mirrors the backend `StaffAssignmentDto`). |

### Backend contract consumed

- `GET /api/staff/assignments` → `StaffAssignmentDto[]` (`{ exerciseId, exerciseName,
  role }`); `401` when there is no authenticated staff session.
- `POST /api/staff/active-exercise { exerciseId }` → the newly-active
  `StaffAssignmentDto`; `400` malformed/unknown exercise, `401` no staff session, `403`
  the caller is not assigned to that exercise.

See `src/Pulse.WebApi/Features/Identity/Staff/` (identity-auth-roles/05).

The staff bearer token is attached by the shared client's auth layer (wired by the
staff identity/session story), not by this feature.

### Currently-active exercise

`ExerciseSwitcher` reads the CURRENTLY active exercise from `useExerciseContext()`
(`@/core/exerciseContext` — the same frozen scope seam `StaffHeader` already consumes)
and matches it against the assignment list by `exerciseId`. See the component's own
header comment for the documented limitation: `ExerciseContextProvider` resolves once
on mount and has no refetch hook, so immediately after a switch this component reflects
the new active exercise from the switch mutation's own response, while the
`useExerciseContext()`-sourced scope elsewhere on the page needs a follow-up (provider
refetch capability, or a host reload) to fully catch up.

### Mounting

`App.tsx` (orchestrator-owned) mounts this into a pre-conduct staff route in
`app-shell/01`. Mount it inside a COBRA `ThemeProvider`, an `ExerciseContextProvider`,
and a React Query `QueryClientProvider`.

### Out of scope

The LIVE-CONDUCT static identity badge (`console-shell/03`, `StaffHeader`'s identity
badge) is a different, non-interactive surface — this switcher is the pre-conduct
control only and does not gate its own visibility by exercise lifecycle status.
