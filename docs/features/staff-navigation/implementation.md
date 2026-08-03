# Implementation: Staff navigation

> Bridge between planning and orchestration. All-frontend feature — no backend contract is needed
> for any of the four stories (the registry is a client-side data module; the exercise-context
> refresh works against the already-live `/api/staff/active-exercise`). Foundation-first: the
> registry (story 01) precedes the launcher that reads it (story 02); the other two stories are
> independent bug-fix-shaped work that can run in parallel with either.

> **Build-state note (post Gate-2, this wave):** all four stories are built. Gate 2 found one
> Critical (CR-001, story 04) and four non-blocking findings (WR-002/WR-004/WR-005/WR-007). None of
> the four is Complete — see each story's file and `feature.md`'s status table for the live detail.
> This file's "Per-story tech notes" table below is updated to reflect what was **actually** built,
> not the pre-build plan; the original plan's "TBD by whichever builder" placeholders are resolved.

## Per-story tech notes

| Story | Approach (as built) | Key files | Exports (that others import) |
|-------|----------|-----------|------------------------------|
| 01 staff-route-tree | A world-neutral registry **shape** module + a staff-world **concrete table**, split so the table can import concrete surfaces without the shape module ever needing to. A nested descendant `<Routes>` (`StaffRouteTree`) mounted by `RoleAwareEntry` only after the role resolves to staff. A context (`staffNavigationContext.tsx`) added mid-wave to deliver `{registry, role}` to in-surface chrome without closing an import cycle. | `features/app-shell/staffRouting.ts` (shape + resolvers); `features/staff/staffRouteRegistry.tsx` (the table — 3 entries); `features/app-shell/StaffRouteTree.tsx`; `features/app-shell/RouteFocusScope.tsx` (extracted from `RoleAwareEntry`); `features/app-shell/staffNavigationContext.tsx`; edits to `RoleAwareEntry.tsx`/`routes.tsx`/`App.tsx` (registry injection) | `StaffRouteRegistry`/`StaffRouteEntry`/`StaffSurfaceRole` types, `staffRoutesForRole`, `resolveDefaultStaffRoute`, `toDescendantRoutePath` (`staffRouting.ts`); `STAFF_ROUTE_REGISTRY`, `StaffRouteId` (`staffRouteRegistry.tsx`); `useStaffNavigation()` (`staffNavigationContext.tsx`) — story 02 imports this last one |
| 02 surface-launcher | A disclosure-menu component composed into `StaffHeader`'s existing lockup slot, reading the registry via `useStaffNavigation()` (story 01's context) with explicit props as an override | `features/staffShell/components/SurfaceLauncher.tsx`; edits `features/staffShell/components/StaffHeader.tsx` (added `staffRoutes`/`role`/`currentPath` props, forwarded into the launcher) | `<SurfaceLauncher>` — **not currently wired as explicit props from any `*Route.tsx` composition; relies entirely on the story-01 context, which degrades to a static lockup for every role today (WR-002 — see story 02)** |
| 03 deep-linked-planner-sections | Swapped `ExerciseSettingsPage`'s `useState` section id for a `useSearchParams`-synced value behind the existing `selectSection` callback (focus-management effect untouched — see story 03's amended AC5); added `AccountImport` as a sixth `SECTIONS` entry (no wrapper needed — it already takes no props) | edits `features/planner/pages/ExerciseSettingsPage.tsx` only | — (internal to the page) |
| 04 exercise-switcher-context-refresh | Added `useExerciseScopeRefresh()` to `ExerciseContextProvider` (server-authoritative, atomic-commit, fail-closed); `useSetActiveExercise` calls it in a cancel→re-resolve→commit→reset order; removed (not converted) `ParticipantAdminFlyout`'s dead footer link | edits `core/exerciseContext/exerciseContext.tsx`, `features/staff/hooks/useSetActiveExercise.ts`, `features/staffShell/components/ParticipantAdminFlyout.tsx` | `useExerciseScopeRefresh()`, `ExerciseScopeRefresh` type (`exerciseContext.tsx`) — **CRITICAL (CR-001): the mechanism is proved only against a single-provider test fixture; the app's REAL composition nests another `ExerciseContextProvider` inside each staff route composition (`App.tsx`'s "Each staff route composition mounts its OWN `ExerciseContextProvider`"), so refreshing the OUTER provider (where `ExerciseSwitcher` lives) never reaches the INNER one (where `StaffHeader`'s badge reads). Fix in progress — see story 04.** |

Backend: none of these four stories need a new endpoint. Story 04 consumes the already-live
`POST /api/staff/active-exercise` (identity-auth-roles/05).

## Reuse map
- COBRA theme + `@/theme/styledComponents` (`CobraLinkButton`, `CobraStyles`) — `src/frontend/src/theme/`.
- Exercise-context / roles (E1) — `core/auth/roles.ts` (`useRole`, `ExerciseRole`), `core/
  exerciseContext/exerciseContext.tsx` (`useExerciseContext`) — story 04 extends the latter in place.
- `RoleAwareEntry` / `routes.tsx` (`features/app-shell/`) — story 01 nests underneath, does not
  replace.
- `StaffHeader` (`features/staffShell/components/StaffHeader.tsx`) — story 02's mount point.
- `ExerciseSettingsPage` / `SECTIONS` registry (`features/planner/`) — story 03's edit point.
- `ExerciseSwitcher`, `ParticipantAdminFlyout` (`features/staff/`, `features/staffShell/`) —
  story 04's edit points.
- FontAwesome icons (`@fortawesome/react-fontawesome`) — never `@mui/icons-material`.
- React Router 7 (`createBrowserRouter`, `useSearchParams`/`useParams`) — stories 01 and 03.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 staff-route-tree | frontend | `staffRouting.ts`, `staffRouteRegistry.tsx`, `StaffRouteTree.tsx`, `RouteFocusScope.tsx`, `staffNavigationContext.tsx`, route-table edits | `app-shell/01` (exists) | 04 | 1 | M |
| 04 exercise-switcher-context-refresh | frontend | `exerciseContext.tsx`, `useSetActiveExercise.ts`, `ParticipantAdminFlyout.tsx` | `exercise-isolation/05`, `staff-shell/03` (both exist) | 01 | 1 | S |
| 02 surface-launcher | frontend | `SurfaceLauncher.tsx`, edits `StaffHeader.tsx` | 01 (registry + `staffNavigationContext`) | — | 2 | M |
| 03 deep-linked-planner-sections | frontend | edits `ExerciseSettingsPage.tsx` | none hard (agrees with 01 on URL shape, does not require it merged first) | 01, 02, 04 | 1 | M |
| — CR-001 fix (in progress) | frontend | likely `App.tsx`, `RoleAwareEntry.tsx`, and/or the three `*Route.tsx` compositions (removing or bridging the duplicate `ExerciseContextProvider` mount) plus a new nested-fixture integration test | 04 (built) | — | 3 (post-Gate-2) | M |

Wave 1 fans out three file-disjoint stories (01, 03, 04 touch no common file — confirmed as built).
Wave 2 is story 02 alone because it is the only story that both reads story 01's registry export
(via `staffNavigationContext`) and edits `StaffHeader.tsx` (which story 04 also edits, in a
different region — sequence 02 after 04 merges to avoid a needless same-file collision, even though
the two touch different parts of the file). **Wave 3 does not exist in the original plan** — it is
the Gate-2 CR-001 remediation, added here because it is active work, not a future story: whoever
picks it up should expect to touch `App.tsx`'s provider-hoisting comment block and possibly remove
the "each staff route composition mounts its OWN `ExerciseContextProvider`" pattern entirely rather
than bridge it, since a benign mount-time-only re-resolve and a scope that must now change
mid-session are different problems wearing the same code.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Frontend composition root | `src/frontend/src/App.tsx` | If story 01's route-table design needs a new top-level route object (rather than nesting entirely inside `RoleAwareEntry`'s existing render), that addition is spliced in here, serially, between waves. |
