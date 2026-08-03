# Story: Exercise list & management (org-scoped)

**Feature:** Exercise lifecycle administration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Backend built — frontend outstanding, awaiting Tier-2 sign-off
**Requirements:** COR-075  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** fullstack  ·  **Review:** Tier-2 (org-boundary read)

> **Backend built:** `GET /api/org/exercises`
> (`Pulse.WebApi/Features/ExerciseLifecycleAdmin/ExerciseListService.cs`). The **list surface itself is NOT
> built** — the row-rendering, row-action and accessibility ACs below are struck through accordingly.

## Context
Story 01 gives a Planner/OrgAdmin a way to create an exercise. This story gives them somewhere to
land **before** that (to see what already exists) and **after** (to find what they just made): a
list of the exercises their organization owns, scoped by organization the same way
`ExerciseSwitcher` is scoped by the caller's own `StaffAssignment` set — except this list is not
"exercises I'm assigned to," it is "exercises my organization owns," which is a strictly larger set
for an OrgAdmin (who administers the organization, not just the exercises they personally have an
assignment on) and the natural home for the "duplicate this exercise" action (`COR-045`,
`exercise-build-golive/06`) and a link into each exercise's settings
(`exercise-configuration/01b`'s `ExerciseSettingsPage`) and readiness dashboard
(`exercise-build-golive/03`).

## Acceptance Criteria
- [x] Given a Planner or OrgAdmin session, when they open the exercise list surface, then it shows
      **only** exercises owned by their organization (`OrganizationId` match) — never a global,
      cross-organization list, and never another organization's exercise even by row count or name.
- [x] **(data only)** Given the list, when it renders each row, then it shows at minimum: name, lifecycle
      status (COR-032, ~~text + icon, never color-only~~), hostname, and created date — enough to distinguish
      exercises without opening each one. **Partial:** the endpoint SERVES all four fields (a new nullable
      `Exercise.CreatedAt` column was added for the fourth, migration `20260802124443_ExerciseCreatedAt`) and
      folds a legacy status literal onto its canonical COR-032 form. The **text + icon, never-color-only**
      rendering is a frontend obligation and is not built.
- [ ] ~~Given a row, when the caller acts on it, then they can navigate to that exercise's settings
      (`exercise-configuration`'s `ExerciseSettingsPage`), duplicate it (`COR-045`,
      `exercise-build-golive/06`, once that story is built), or reach its readiness dashboard
      (`exercise-build-golive/03`, once built) — this story provides the **list and the links**, not
      the destinations themselves.~~ **Not built — frontend only.** The endpoint returns the `exerciseId`
      every one of those links needs; the links themselves do not exist yet.
- [x] Given a caller attempts to reach another organization's exercise directly (e.g. a guessed or
      shared exercise-settings URL for an exercise outside their org), when the request resolves,
      then it fails closed (403/404) — extending the standing isolation suite
      (`exercise-isolation/07`) with the organization-axis case `exercise-isolation/11` introduces.
- [x] Given a Controller or Evaluator session, when they look for this surface, then it is not
      reachable — exercise list/management is Planner/OrgAdmin only (they already reach their
      individual assigned exercises through the existing exercise switcher, a different, narrower
      concern).

### Cross-cutting
- [x] **Isolation (XC-001, org axis / COR-001):** see the fail-closed AC above; no exercise from
      another organization is ever renderable, searchable, or inferable from this surface.
- [ ] ~~**Accessibility (NFR-001):** the list is a real, labeled table/list structure, keyboard
      navigable, with status conveyed by icon + text, never color alone.~~ **Not built — frontend only.**

## Out of Scope
Exercise creation itself (story 01); exercise duplication's own mechanics (`exercise-build-golive/06`);
per-exercise settings editing (`exercise-configuration`); archiving/deleting an exercise (no
requirement currently covers exercise deletion — `COR-054` EndEx and `COR-032`'s `archived` state
are the closest existing lifecycle concepts; this story surfaces status, it does not add a new
transition); staff assignment management within an exercise (that remains
`identity-auth-roles`/`console-shell`'s participant-admin scope) — this story's "management" is
**exercise-level** (which exercises exist, org-wide), not participant- or staff-assignment-level.

## Technical Notes
Fullstack. Backend: an org-scoped `GET` endpoint (e.g. `GET /api/org/exercises`) reading
`Exercise` filtered by the caller's resolved `OrganizationId` — **not** the per-exercise
`IExerciseScoped` filter (which scopes to one exercise; this is the tier above it,
`exercise-isolation/11`'s org-scoping axis). Frontend: a staff surface registered into
`staff-navigation/01`'s registry, likely the OrgAdmin surface's (story 03) landing view, also
reachable from the Planner group. COBRA table/list components, `@fortawesome/react-fontawesome`
status icons. See implementation.md (story 02).

## Dependencies
`exercise-isolation/11` (`Organization` entity + org-scoping — hard prerequisite, in parallel);
story 01 (exercise creation — this list is empty and pointless without it, though the two can be
built in either order against a seeded/bootstrap-created exercise for development); story 03
(OrgAdmin surface family — this story's most natural mount point); `staff-navigation/01` (registry).

## Built as
`GET /api/org/exercises` — `ExerciseListService`, bounded by
`OrganizationScope.InOrganization(callerOrganizationId)` where the tenant is the SERVER-resolved one
(`IOrganizationContext`, populated by the new `app.UseOrganizationResolution()`), never a client value.
`Exercise` carries no global query filter on either axis (it is both scope roots' resolution target), so the
bound is written explicitly and fails closed to zero rows on an unresolved tenant.

**How this differs from the pre-existing `GET /api/staff/assignments`, deliberately.** That read is
OWN-ONLY (filtered by the caller's `StaffUserId`) and exists to populate the exercise switcher. This one is
ORG-WIDE: an org-admin administers the customer's portfolio including runs they hold no `StaffAssignment`
on, and a planner needs to see what already exists before creating another. Neither is a useful superset of
the other, and folding them would mean either leaking unassigned exercises into the switcher or hiding the
organization's own runs from its administrator. They stay two endpoints with two different bounds.

**The "reach another organization's exercise directly" AC.** There is no by-id route to reach — the org tier
exposes no route parameter at all, which is asserted structurally
(`CompositionRootWiringTests.TheOrgTierRoutes_TakeNoRouteParameters_...`). The pre-existing cross-org IDOR
vector (a guessed exercise-settings URL) is closed one tier down by `StaffAssignmentService`'s
`SetActiveExerciseAsync` org check, proved by `StaffOrganizationBoundaryTests` (`exercise-isolation/11` AC3),
which this story does not duplicate.

## Tests
All real-SQL tests are `[RequiresDockerFact]` and were **run** against LocalDB, not skipped. Each isolation
test carries BOTH controls: a positive control (the caller's own rows ARE returned, so a blanket-deny
regression cannot pass) and an unbounded control read (the other customer's rows DO exist, so a zero is the
tenant bound closing the door rather than an empty table). Every guard was **neutered and watched go red**.

**AC1 + XC-001 — only the caller's organization's exercises**
- `ExerciseListEndpointTests.List_ReturnsOnlyTheCallersOrganizationsExercises_NeverAnotherCustomers (AC1, XC-001)`
- `ExerciseListEndpointTests.List_DoesNotLeakTheOtherCustomersPortfolioSize_ThroughTheRowCount (AC1, XC-001)`
- `OrganizationResolutionPipelineOrderTests.AStaffSessionWhoseTenantCannotBeResolved_ReachesNothing_RatherThanEverything (XC-001)`

**AC2 (data half) — the four row fields**
- `ExerciseListEndpointTests.List_Row_CarriesNameStatusHostnameAndCreatedDate (AC2)`
- `ExerciseListEndpointTests.List_FoldsALegacyStatusLiteralOntoItsCanonicalCor032Equivalent (AC2)`
- `MigrationRoundTripTests.Exercise_RoundTrips_WithTheOrgAdminCreatedAtColumn (AC2)`

**AC4 — a cross-organization reach fails closed**
- `CompositionRootWiringTests.TheOrgTierRoutes_TakeNoRouteParameters_SoThereIsNoIdorSurfaceOnTheOrgAxis (AC4)`
  — there is no by-id route to guess, which is a stronger guarantee than refusing one particular guess.
- At the tier below, the standing `StaffOrganizationBoundaryTests` suite (`exercise-isolation/11` AC3).

**AC5 — Controller/Evaluator cannot reach it; Planner can**
- `ExerciseListEndpointTests.List_AsController_IsRefused (AC5)`
- `ExerciseListEndpointTests.List_AsEvaluator_IsRefused (AC5)`
- `ExerciseListEndpointTests.List_AsPlanner_IsAdmitted_BecauseStory02IsPlannerOrOrgAdmin (AC5, positive control)`
- `ExerciseListEndpointTests.List_WithNoSession_IsUnauthorized_NeverAnEmpty200 (AC5)`
