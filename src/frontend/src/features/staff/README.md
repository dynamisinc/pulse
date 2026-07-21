# features/staff (STAFF world — COBRA)

Staff-console cross-exercise surfaces for Pulse. **This is the staff world (D0 §2):**
COBRA look via `@/theme/styledComponents`-adjacent tokens (`CobraStyles`), FontAwesome
icons only, MUI system props through `sx` (MUI 9). It must never read as a participant
skin, and it never mounts a participant/brand theme.

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
