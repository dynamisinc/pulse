# Story: Exercise creation (backend endpoint + Planner/OrgAdmin surface)

**Feature:** Exercise lifecycle administration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Backend built — frontend outstanding, awaiting Tier-2 sign-off
**Requirements:** COR-074  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** fullstack  ·  **Review:** Tier-2 (new customer-facing creation path + org-boundary write)

> **Backend built:** `POST /api/org/exercises`
> (`Pulse.WebApi/Features/ExerciseLifecycleAdmin/`). The **frontend creation surface is NOT built** — the
> ACs below are ticked for the backend behaviour they describe; the accessibility AC is struck through as
> out of this pass. See "Built as" below.

## Context
No requirement in the entire corpus currently covers "create an exercise." The only creation
language anywhere is the un-IDed UX narrative at `docs/01-platform-core-isolation.md` §5 ("From the
staff console: create exercise → configure world → …"), and `COR-045` (exercise duplication)
presupposes a create path that has never existed as a requirement, a story, or a customer-facing
endpoint. The only thing that creates an `Exercise` row today is
`POST /api/ops/bootstrap-exercise` (`Pulse.WebApi/Features/Ops/Bootstrap/BootstrapEndpoints.cs`),
gated **entirely** by a deployment secret (`X-Bootstrap-Secret`) rather than a role or session — its
own `BootstrapOptions` doc comment is explicit: "PHASE-1 / UAT-ONLY SEAM… disabled by default and
MUST NOT be reachable in a real customer-facing deployment." This story builds the real thing: a
role-gated, session-authenticated creation path a Planner or OrgAdmin uses from a staff surface.

This story is a **hard prerequisite for `COR-045`** (`exercise-build-golive/06-exercise-duplication.md`),
which has always assumed a create path exists — it did not, until now.

## Acceptance Criteria
- [x] Given an authenticated **Planner or OrgAdmin** session, when they submit a new exercise's
      minimal required fields (internal name at minimum — COR-030's other settings keep their
      documented defaults, e.g. `TimeZone: "UTC"`, `Status: "build"`, `ComplianceChromeEnabled: true`,
      `WatermarkEnabled: true`, `IsPracticeMode: false`, matching `Exercise.cs`'s existing column
      defaults exactly), then a new `Exercise` row is created with lifecycle status `build` (COR-032)
      — never any other status — and is otherwise indistinguishable from a bootstrap-seeded exercise.
- [x] Given the new exercise, when it is created, then the platform allocates it a unique
      `Hostname` (COR-008) — server-generated or validated-unique if the caller proposes one — using
      the same `Hostname`/`BrandedDomain` columns and uniqueness guarantee (`Exercise.cs`'s
      filtered unique index) the bootstrap seam and `exercise-isolation/08`'s host-resolution
      middleware already rely on. No two exercises, across any organization, ever collide on a
      hostname.
- [x] Given the creator, when the exercise is created, then a `StaffAssignment` row is auto-created
      binding the creator's `StaffUserId` to the new `ExerciseId` (role matching the creator's own
      role — `planner` or `orgAdmin`) so they can immediately reach it via the exercise switcher
      (`exercise-isolation/05`) with no separate provisioning step.
- [x] Given the caller's own organization, when the exercise is created, then it is recorded as
      **owned by that organization** — the `OrganizationId` is always derived server-side from the
      caller's own resolved organization (via the `Organization` tenant tier,
      `exercise-isolation/11`), **never** from a client-supplied organization id — the same
      never-trust-a-client-supplied-scope discipline `Exercise.cs`'s own isolation-warning comment
      already states for every settings read/write.
- [x] Given a **Controller or Evaluator** session, when they attempt to create an exercise (via the
      surface or the endpoint directly), then the action is refused — creation is Planner/OrgAdmin
      only.
- [x] The `POST /api/ops/bootstrap-exercise` seam is **untouched** by this story: its secret gate,
      its rate limit, and its "disabled by default, not for customer-facing use" posture are not
      weakened, deprecated, or routed through this new path.

### Cross-cutting
- [x] **Isolation (XC-001, org axis / COR-001):** an attempt to create an exercise under an
      organization the caller does not belong to fails closed (never silently reassigns to the
      caller's own org, never succeeds under the requested foreign org) — extends the standing
      isolation suite (`exercise-isolation/07`) at the organization tier, alongside
      `exercise-isolation/11`'s own cross-org AC.
- [x] **Telemetry:** exercise creation is logged as an auditable staff action (actor + wall/scenario
      time), following the `ParticipantAdminFlyout` precedent (`actor.kind: 'system'` +
      `actor.actingHumanId` for a genuine staff action, per the v0 envelope's documented lack of a
      dedicated staff `actor.kind`) — not a participant/persona content event.
- [ ] ~~**Accessibility (NFR-001):** the creation form/surface is keyboard-operable with accessible
      labels and error messaging that is never color-only.~~ **Not built — frontend only.** There is no
      creation form yet; this backend pass built the endpoint the form will call. Stays open for whoever
      builds the surface.

## Out of Scope
The Build→Staged→Live behavior of an exercise once created (`exercise-build-golive`); exercise
duplication itself (`exercise-build-golive/06`, COR-045 — this story is its prerequisite, not its
replacement); the exercise list/management surface a caller uses to find what they've created
(story 02); the `Organization` entity's own schema/migration (`exercise-isolation/11` — this story
consumes it, does not build it); customer/org **self-service signup** (out of scope entirely —
organizations and their first OrgAdmin are provisioned by Dynamis staff, matching COR-011's
no-self-signup posture at the org tier).

## Technical Notes
Fullstack. Backend: a new `Features/ExerciseLifecycleAdmin/` (or similarly named) minimal-API slice
— **not** an extension of `Features/Ops/Bootstrap/`, which stays the secret-gated seam it already
is. Gated by the existing staff-session + role-authorization pattern (`EngineCockpitStaffAuthorizationFilter`-
style, per `exercise-configuration/feature.md`'s open question (a) precedent — this story should
**not** repeat that gap: gate on role, not just "a live staff session," from day one). Writes
`Exercise` (new row, `Data/Entities/Exercise.cs`) + `StaffAssignment` (new row,
`Data/Entities/StaffAssignment.cs`) + the new `OrganizationId` column `exercise-isolation/11` adds.
Frontend: a staff surface registered into `staff-navigation/01`'s registry (a "Create exercise"
entry under the Planner/OrgAdmin group), COBRA form components. See implementation.md (story 01).

## Dependencies
`exercise-isolation/11` (`Organization` entity + `OrganizationId` — hard prerequisite, currently
being pulled forward in parallel; do not start ahead of it landing); `exercise-isolation/08`
(hostname resolution, Complete); `identity-auth-roles/05` (`StaffUser`/`StaffAssignment`, Complete);
`exercise-configuration/01a` (the `Exercise` settings columns + their defaults, merged);
`staff-navigation/01` (the registry this surface registers into). Blocks
`exercise-build-golive/06` (COR-045, exercise duplication).

## Built as
`POST /api/org/exercises` — `Pulse.WebApi/Features/ExerciseLifecycleAdmin/` (`ExerciseCreationService`,
`ExerciseAdminDtos`, `OrgAdminAuthorizationFilter`, `StaffCallerContext`,
`ExerciseLifecycleAdminEndpoints`). Route prefix `/api/org/*`, deliberately **not** `/api/staff/*`: every
existing `/api/staff/*` route is scoped to the ONE server-resolved exercise, while these span the caller's
whole customer tenant.

Three decisions worth naming, because each closes an AC in a way the AC did not dictate:

1. **Hostname uniqueness is enforced by the DATABASE, not by a pre-flight read.** A "is this host taken"
   query would have to be unbounded across every customer (uniqueness is global by design — `Exercise.cs`'s
   filtered unique index, and `HostExerciseResolver` fails closed on an ambiguous host), and its answer would
   still race the insert. So the create stages exercise + assignment + telemetry in ONE unit of work and maps
   a unique-key violation to `409`. A refused create therefore leaves **no** exercise, **no** assignment and
   **no** telemetry — proved, not assumed.
2. **A caller who proposes no hostname gets a server-allocated one:** a slug of the name plus an 8-hex
   suffix, valid by construction against the same `ExerciseHostName` normalizer host resolution uses. It is a
   DNS **label**, not a provisioned FQDN — pointing DNS at it (and any branded domain) is COR-008/COR-009
   deployment work this story does not own.
3. **One new nullable column, one migration:** `Exercise.CreatedAt` (`20260802124443_ExerciseCreatedAt`),
   because story 02's AC2 requires a created date and no column carried one. Nullable on purpose — the
   creation instant of pre-existing rows is genuinely unknown, and the migration's own run time would be a
   fabricated date rendered to a staff human as fact.

## Tests
All real-SQL tests are `[RequiresDockerFact]` and were **run** (`PULSE_TEST_SQL_CONNECTION` → LocalDB), not
skipped. Every one drives the REAL `Program` pipeline with a real seeded session and a real bearer token, so
the exercise scope, the customer tenant, the default-deny gate and the role filter are all decided by
production middleware. Every guard below was **neutered and watched go red**.

**AC1 — a `build` exercise with the documented defaults**
- `ExerciseCreationEndpointTests.Create_AsPlanner_PersistsABuildExercise_OwnedByTheCallersOrganization_WithACreatorAssignment (AC1, AC3, AC4)`
- `ExerciseCreationEndpointTests.Create_WithNoName_IsRejected_AndWritesNothing (AC1)`
- `ExerciseCreationEndpointTests.Create_SanitizesTheName_StrippingMarkupRatherThanStoringIt (AC1, NFR-004)`

**AC2 — a unique hostname, globally**
- `ExerciseCreationEndpointTests.Create_WithAProposedHostname_NormalizesAndStoresIt_SoHostResolutionCanFindIt (AC2)`
- `ExerciseCreationEndpointTests.Create_WithNoProposedHostname_AllocatesOneThatHostResolutionWouldAccept (AC2)`
- `ExerciseCreationEndpointTests.Create_WithAHostnameAnotherCustomersExerciseAlreadyHolds_Conflicts_AndCreatesNothing (AC2)`

**AC3 — the creator assignment carries the creator's own role**
- `ExerciseCreationEndpointTests.Create_AsOrgAdmin_MintsAnOrgAdminAssignment_NotAStaffRoleSubstitute (AC3)`

**AC4 + XC-001 (org axis) — the tenant is server-derived and cannot be spoofed**
- `ExerciseCreationEndpointTests.Create_AsPlanner_PersistsABuildExercise_… (AC4)` — asserts the persisted
  `OrganizationId` is the caller's own and *not* the other customer's.
- `OrganizationResolutionPipelineOrderTests.AStaffSessionWhoseTenantCannotBeResolved_ReachesNothing_RatherThanEverything (XC-001)`
- **The spoofed-org-id case is closed STRUCTURALLY, not by a test:** `CreateExerciseRequest` has no
  organization field, and `CompositionRootWiringTests.TheOrgTierRoutes_TakeNoRouteParameters_SoThereIsNoIdorSurfaceOnTheOrgAxis`
  proves no route parameter can carry one either. There is no input to spoof, which is a stronger guarantee
  than a test that a particular spoof is rejected — and
  `ExerciseAdminRolesTests.NoDtoInThisSlice_ExposesTheCustomerTenant` keeps it that way as the DTOs evolve.

**AC5 — Controller/Evaluator refused**
- `ExerciseCreationEndpointTests.Create_AsController_IsRefused (AC5)`
- `ExerciseCreationEndpointTests.Create_AsEvaluator_IsRefused (AC5)`
- `ExerciseCreationEndpointTests.Create_WithNoSession_IsUnauthorized (AC5)`

**AC6 — the ops bootstrap seam is untouched**
- `ExerciseCreationEndpointTests.TheNewCreationPath_IsNotReachableWithABootstrapSecretHeader_OnlyWithAStaffSession (AC6)`
- The seam's own suites are unchanged and still green: `BootstrapEndpointsHttpTests`,
  `BootstrapSecretGateTests`, `BootstrapServiceTests`, `BootstrapOrganizationTests`. The only edit to
  `BootstrapService.cs` in this feature is an added `// org-scope-exempt(TenantRoot):` comment on its
  existing `Organizations` read (see `exercise-isolation/11`'s sweep, WR-008) — no behaviour change.

**Telemetry (XC-004)**
- `ExerciseCreationEndpointTests.Create_EmitsExactlyOneAuditEvent_AttributedToTheActingStaffHuman`

**Composition root (so this cannot ship merged-but-dead)**
- `CompositionRootWiringTests.ProgramCs_MapsTheThreeOrgAdministrationRoutes_ExactlyOnceEach`
- `CompositionRootWiringTests.ProgramCs_CallsAddExerciseLifecycleAdmin_SoEveryHandlerDependencyResolves`
