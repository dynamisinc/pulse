# Feature: Staff navigation

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.7
**World:** staff  ·  **Issue:** —

## Summary
The staff surface-switching model that does not currently exist anywhere in Pulse. Today
`RoleAwareEntry` (feature: `app-shell`) sends each staff role to exactly **one** hardcoded
`ReactNode` behind a single `*` catch-all route (`src/frontend/src/features/app-shell/routes.tsx`)
— there is no path, no bookmark, no back/forward, and no way to reach a second surface without a
code change to that role's entry. Roughly 40 planned staff surfaces across E1/E4/E5/E6/E7/E8/E10
(persona library, cast management, readiness dashboard, news/press/weather composers, the engine
review cockpit, evaluation timeline, org administration…) have **no door**. This feature adds the
door: a real staff route tree behind a staff surface registry, a role-gated launcher on the staff
header, URL-addressable planner settings sections (closing the `AccountImport`-orphan open
question), and the fix for the exercise-switcher's stale-context display bug.

## Requirements covered
COR-070 (staff route tree & surface registry), COR-071 (surface launcher), COR-072 (deep-linked
configuration sections), COR-073 (live exercise-context refresh on switch). See
`docs/01-platform-core-isolation.md` F1.7 for the full requirement text and the decision to file
these IDs into the epic (rather than continuing the un-backfilled `COR-060`–`COR-066` pattern).

## Design references
`docs/design/D7-application-shells/SHELL-CONTRACT.md` §1 "Staff shell owns" — the header's brand
lockup (`PULSE` / surface name) and the one-toolstrip-dock rule (D7-011) are the two constraints
this feature must honor: **no new chrome element**. The surface launcher (story 02) turns the
existing static lockup into an interactive control; it does not add a nav rail (would contest the
shell's three-element ownership — header / toolstrip / work area) and does not add a second
toolstrip tenant (the toolstrip is reserved for consult-on-demand flyouts per D7-011/D5-017). This
is a **navigation-model decision this feature introduces**, not a filed D7 design amendment — it is
recorded here and cross-referenced from `docs/design/D7-application-shells/STORY-UPDATES.md` (a new
ADD entry) and noted in `SHELL-CONTRACT.md`'s Header row, but it does not carry a `D#-xxx` decision
id of its own. **Design decisions:** none (see the note above).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Staff route tree & surface registry | COR-070 | In Progress — built; Gate-2 raised a non-blocking divergence (WR-005, eager not lazy) | — |
| 02 | Surface launcher (header brand-lockup, role-gated) | COR-071 | In Progress — built; not user-observable in production yet (WR-002 — every role today resolves to exactly one surface) | — |
| 03 | Deep-linked planner settings sections + AccountImport's home | COR-072 | In Progress — built; AC5 amended (WR-004) | — |
| 04 | Exercise-switcher context refresh + the dead participant-admin footer link | COR-073 | Blocked — CRITICAL defect (CR-001) found at Gate 2, fix in progress; WR-007 (no recovery affordance on a failed refresh) also being fixed | — |

**Gate-2 status (this wave): NOT clean.** All four stories were built in this wave, but the review
found one Critical (CR-001, story 04 — the header badge does not reflect a switch in the app's real
nested-provider composition) and several non-blocking findings (WR-002, WR-004, WR-005, WR-007 —
see each story for detail). Nothing in this feature is Complete. A prior pass of these files marked
every story "Not Started" with every AC unticked despite all four being built — that was wrong and
has been corrected here; do not re-introduce that drift when a story's Status changes again.

### What was actually built (real files, this wave)
- `features/app-shell/staffRouting.ts` — the world-neutral registry shape + pure resolvers (story 01)
- `features/staff/staffRouteRegistry.tsx` — the concrete three-entry table (story 01)
- `features/app-shell/StaffRouteTree.tsx` — the nested descendant route tree (story 01)
- `features/app-shell/RouteFocusScope.tsx` — extracted, route-keyed focus scope (story 01)
- `features/app-shell/staffNavigationContext.tsx` — registry+role publisher, added mid-wave once the
  launcher's import-cycle problem surfaced (story 01, consumed by story 02)
- `features/staffShell/components/SurfaceLauncher.tsx` + `StaffHeader.tsx` integration (story 02)
- `ExerciseSettingsPage.tsx`'s `?section=` URL-sync + `AccountImport` as a sixth section (story 03)
- `core/exerciseContext/exerciseContext.tsx`'s `useExerciseScopeRefresh()`, `useSetActiveExercise.ts`'s
  cancel→re-resolve→commit→reset ordering, and the removed `ParticipantAdminFlyout.tsx` dead footer
  link (story 04 — **the refresh mechanism has a Critical defect in the app's real composition; see
  story 04**)

## Dependencies
`app-shell/01` (Complete — `RoleAwareEntry`, the role decision this feature adds path structure
underneath, never replaces); `staff-shell/01` (Complete — `StaffHeader`, whose brand-lockup slot
story 02 makes interactive) and `staff-shell/02` (Complete — the toolstrip dock, explicitly **not**
touched by this feature); `exercise-isolation/05` (Complete — `ExerciseSwitcher`, whose documented
"no refetch" follow-up story 04 closes); `exercise-configuration` (story 03's `AccountImport` home
closes that feature's open question (b)); `identity-auth-roles/01` (role vocabulary, including
`orgAdmin` as its own surface family — story 01's registry is what a later `exercise-lifecycle-admin`
feature registers the OrgAdmin surface into). The `App.tsx` route-table edit is orchestrator-owned,
per house convention.

## Design notes
**Staff world only.** Nothing here touches the participant catch-all beyond confirming it is
unchanged (COR-004) — a participant session still resolves to exactly one landing surface with no
route table, no picker, and no exercise-selection concept (XC-002). Everything staff gets here —
real paths, a launcher, deep-linked sections — is explicitly the elevated-surface exception XC-002
already carves out for controllers/evaluators/planners/OrgAdmins, never a precedent for participant
routing. Accessibility (NFR-001) is load-bearing throughout: the launcher is a real menu (keyboard
operable, `aria-haspopup`, arrow-key/Escape semantics), and deep-linked sections must not break the
existing focus-management contract `ExerciseSettingsPage` already implements. No participant
free-text/upload paths and no new telemetry event type are introduced by this feature (routing is
not a telemetry-worthy participant/persona action, XC-004) — the exercise-creation telemetry (if
any) lives in `exercise-lifecycle-admin`, not here.
