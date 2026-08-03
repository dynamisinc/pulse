# Story: Organization tenant boundary (customer scoping above the exercise)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Built — awaiting Tier-2 sign-off
**Requirements:** COR-001 (the scoping tier above the exercise), COR-010 (OrgAdmin) + the epic entity model
(`docs/01-platform-core-isolation.md` — `Organization` = "Tenant boundary (customer)")  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** backend  ·  **Review:** Tier-2 (schema + isolation — the customer tenant boundary)

> **✅ DECISION (resolved) — Option B: deferred, and a hard prerequisite for multi-customer go-live.** The
> design names `Organization` as the customer **tenant boundary** ("Owns exercises, persona templates, cast
> libraries. Mirrors Cadence's org concept" — `docs/01-platform-core-isolation.md` entity table). It is **not
> built** (B0 deferred it; the B2 slice did not add it), and that is the accepted state **while Pulse runs a
> single customer** — today it is multi-tenant on the **exercise** axis only. This story stays a tracked
> backlog item and is **pulled into a dedicated wave before a second customer is onboarded**: multi-customer
> go-live is BLOCKED until it lands. The gate *is* the guardrail — it prevents the cross-customer
> `PersonaTemplate`/cast leak (gap 2 below) from ever shipping to customer #2, with no interim throwaway
> scaffolding. Single-customer is the explicit operating assumption until then.

## Context
Pulse's isolation design has **two nested tiers**:

```
Organization  (customer tenant — mirrors Cadence's OrganizationId)
   └── owns many  Exercises  (the participant-facing isolation scope — COR-001, built)
                     └── Posts · Personas · Accounts · Sessions · TelemetryEvents (IExerciseScoped)
```

The **Exercise** tier is the always-Critical participant guarantee and is built (`exercise-isolation/01` +
the B2 scope-resolution seam, story 08). The **Organization** tier — the customer that *owns* exercises,
persona-template libraries, cast libraries, named accounts, and staff — is designed but unbuilt. This is not
a participant-isolation hole (two exercises are isolated whether or not they share an org), but it is a
**customer-isolation** hole once more than one customer exists.

**Distinct from COR-018.** The *in-fiction* "organization account" (a persona posting **as** an agency/outlet,
per-human attribution — `identity-auth-roles/09-org-account-operation.md`) is a content/attribution concept
and is **not** this story. This story is the platform **customer tenant**.

## Current-state gaps (why this matters)
1. **Staff/planner access is not customer-scoped.** B2's `StaffAssignment` scopes a staff user to specific
   *exercises* (a partial substitute), but there is no `Organization` to group exercises under a customer, no
   `OrganizationId` on the schema, and the `OrgAdmin` role (COR-010) has nothing to administer.
2. **`PersonaTemplate` / cast libraries are globally shared today.** `PulseDbContext` deliberately makes
   `PersonaTemplate` **un-scoped** ("a shared library asset, no `ExerciseId`", XC-005) — correct for
   *cross-exercise* reuse, but the design says these are **org-owned**. With no `Organization` boundary, one
   customer's authored templates/cast are visible to every other customer the moment there is a second
   customer. This is a latent **cross-customer leak** — a quieter failure than the cross-exercise one, but a
   real one.

## The decision (RESOLVED → B)
**Chosen: (B) — defer, gated on multi-customer go-live.** Build the exercise tier + auth now (B2 as scoped);
add the `Organization` tenant tier in a dedicated wave triggered when a second customer is on the horizon,
before multi-customer go-live. That wave adds the `Organization` entity + a migration putting `OrganizationId`
on the owned entities (`Exercise`, `PersonaTemplate`/cast, accounts, staff) and the org scoping tier. This
story is the tracked backlog placeholder for that wave; the ACs below apply when it is pulled in.

**Why not the others:** (A) land-in-B2 would widen the identity slice with a tenant tier that has no near-term
consumer (Pulse is single-customer today) — premature. (C) accept-single-tenant-with-a-code-guardrail adds
interim scaffolding we'd then unwind; the go-live gate below achieves the same safety with no throwaway code.

**The gate (what makes B safe):** multi-customer go-live is a **hard blocker** on this story — the
cross-customer `PersonaTemplate`/cast leak (gap 2 above) must be closed before a second customer's data shares
the platform. Track it on the go-live readiness path (COR-042), alongside network readiness (COR-009).

Options considered (for the record):
- **(A) Land in B2** — add `Organization` as a B2 identity-phase story (natural home; owns accounts/staff/
  templates). Rejected: premature, no near-term multi-customer consumer.
- **(B) Later dedicated wave** *(chosen)* — build the org tier in a wave gated on multi-customer go-live.
- **(C) Accept single-tenant + interim code guardrail** — rejected in favor of the go-live gate (no throwaway).

## Acceptance Criteria
- [x] Given the two-tier design, when the model is built, then an `Organization` entity exists as the customer
      tenant boundary and `Exercise` carries a non-nullable `OrganizationId` (an exercise belongs to exactly
      one organization).
- [x] Given org-owned shared assets, when `PersonaTemplate` / cast libraries are queried, then they are scoped
      to the owning organization (not globally shared) — closing the cross-customer leak — while remaining
      shared *across the exercises of that organization* (XC-005 within the org).
- [x] **(reachability only)** Given a staff/planner user, when they authenticate, then their reachable
      exercises ~~and admin surface~~ are bounded by their organization; ~~an `OrgAdmin` (COR-010) administers
      only their own organization~~. **Partial:** reachability is built and proved (login refuses a
      cross-customer exercise; the switcher lists and the switch accepts only the caller's own tenant). The
      **`OrgAdmin` role and the org-admin authorization filter are NOT in this story** — they belong to the
      `exercise-lifecycle-admin` surface family that owns exercise CRUD. Until that lands, `OrgAdmin` still has
      nothing to administer; the entity it will administer now exists.
- [x] Given the two senses of "org", when this is built, then it does **not** touch the in-fiction org-account
      operation (COR-018 / `identity-auth-roles/09`), which stays a separate content/attribution concern.

### Cross-cutting
- [x] **Isolation (XC-001 / COR-001):** a cross-**organization** access attempt fails closed (a query in org X
      never returns org Y's exercises, templates, or accounts). Extends the standing suite
      (`exercise-isolation/07`) with a cross-org case — the org tier gets the same fail-closed proof the
      exercise tier has. **Mechanism: BOTH, on disjoint entity sets** — see "The mechanism as built" below.
- [x] **No participant surface** exposes the organization concept (XC-002) — org is a staff/platform tier only.

## The mechanism as built (the story leaves the choice to the builder; this is it)
The two options the AC offers are **both** used, chosen per entity by whether the entity *can* be filtered:

| Entity | Marker | Bound |
|---|---|---|
| `PersonaTemplate` (+ future cast libraries) | `IOrganizationScoped` | **Central global query filter** on `PulseDbContext`, applied by reflection over the model under its own filter key. Nobody can forget it. This is where "gap 2" lived. |
| `Exercise`, `StaffUser` | `IOrganizationOwned` only | **Fail-closed resolution constraint** `IQueryable.InOrganization(orgId)`. A global filter on these two is a *deadlock*, not a guard: they are the resolution roots (`Host` header → exercise; IdP subject → staff human), looked up *in order to* discover the tenant. |
| every `IExerciseScoped` entity | neither | **Transitively bounded.** An exercise belongs to exactly one organization, so a caller confined to exercise E is already confined to E's org. A redundant `OrganizationId` would be a second, driftable copy of the truth. |
| `Organization` | neither | It **is** the tenant scope — the aggregate root of its own tier, exactly as `Exercise.Id` is the exercise scope. |

Both halves fail closed on `Guid.Empty`, which the write-time `GuardOrganizationScope` guarantees no persisted
row carries. The org filter is registered under a **distinct EF filter key** so the two axes AND together
rather than one silently replacing the other — the exercise axis is byte-for-byte unchanged.

**The opt-in half is the risk, so it has a mechanical guard.** `InOrganization` is forgettable in a way the
central filter is not, so `OrganizationScopeSweepTests` sweeps the production source: every read of an
unfiltered org-owned `DbSet` must either carry `.InOrganization(...)` or an `// org-scope-exempt(<Reason>):`
marker naming a provenance from a fixed vocabulary (`ResolvedScope` / `ResolutionRoot` / `OwnIdentity` /
`TenantChecked`), with a written justification. The exemption inventory is **count-pinned**, so a new unbounded
read cannot land without editing the guard — which puts the tenant decision in front of a reviewer.

## Out of Scope
The in-fiction organization-account operation (COR-018, `identity-auth-roles/09`); the org-admin **UI** (a
later staff-console story once the entity exists); Cadence org **federation** (E9, Phase 4).

## Technical Notes
Backend / platform foundation. When built, `Organization` extends `PulseDbContext` via the B0
create-then-extend pattern (new `DbSet` + `OnModelCreating` config + migration) — not a second context; and it
adds a scoping tier *above* the existing exercise filter. Mirrors Cadence's `OrganizationId` multi-tenancy
(see the reference `backend-agent` org-scoped-service pattern), but layered over Pulse's stricter per-exercise
filter rather than replacing it. See implementation.md (story 11).

## Dependencies
`backend-host/02-persistence-efcore` (`PulseDbContext`, `Exercise`) — Phase B0, landed. If option A/B:
sequences with identity-auth-roles/02 (accounts) + /05 (staff) — the org owns both. Blocks nothing that is
already built; blocks **multi-customer go-live**.

## Tests
All real-SQL tests are `[RequiresDockerFact]` (Testcontainers in CI; `PULSE_TEST_SQL_CONNECTION` → LocalDB
locally). Every one below was **run**, not skipped, and every guard was **neutered and watched go red**.

**AC1 — the entity + the non-nullable tenant on `Exercise`**
- `OrganizationTenantBoundaryMigrationTests.Up_BackfillsEveryPreExistingRowOntoTheDefaultOrganization (AC1)`
- `OrganizationTenantBoundaryMigrationTests.Up_NeverLeavesARowOnTheEmptySentinel_WhichWouldBeUnreachableForever (AC1)`
- `OrganizationTenantBoundaryMigrationTests.Up_SeedsExactlyOneDefaultOrganizationRow_WithTheIdTheEntityConstantNames (AC1)`
- `OrganizationTenantBoundaryMigrationTests.Up_LeavesNoDefaultConstraintOnTheTenantColumns_SoARawInsertCannotMintAnOrphan (AC1)`
- `OrganizationTenantBoundaryMigrationTests.Up_IsIdempotentAcrossADownAndReUp_MintingNoSecondDefaultTenant (AC1)`
- `OrganizationTenantBoundaryMigrationTests.Down_RemovesTheTenantTierCleanly_SoTheMigrationIsReversible (AC1)`
- `OrganizationIsolationTests.WriteGuard_RefusesAnExerciseWithNoOrganization (AC1)`
- `OrganizationIsolationTests.WriteGuard_RefusesAStaffUserWithNoOrganization (AC1)`
- `OrganizationIsolationTests.WriteGuard_RefusesAPersonaTemplateWithNoOrganization (AC1)`
- `BootstrapOrganizationTests.Bootstrap_EmptyDatabase_HomesTheExerciseOnTheWellKnownDefaultOrganization (AC1)`
- `BootstrapOrganizationTests.Bootstrap_ReRun_MintsNoSecondDefaultOrganization (AC1)`
- `BootstrapOrganizationTests.Bootstrap_ReusedExercise_KeepsItsOwnTenant_AndIsNeverReHomedOntoTheDefault (AC1)`

**AC2 — the library is org-owned, still shared across the org's runs (closes gap 2)**
- `OrganizationIsolationTests.PersonaTemplateQuery_InOrganizationX_ReturnsNoneOfOrganizationYsTemplates (AC2)`
- `OrganizationIsolationTests.PersonaTemplate_IsSharedAcrossAllOfItsOwnOrganizationsExercises (AC2)`
- `OrganizationIsolationTests.PersonaTemplate_IsNotSharedAcrossOrganizations_EvenFromAnExerciseScopedRead (AC2)`
- `QueryFilterModelTests.EveryOrganizationScopedEntity_HasTheTenantGlobalQueryFilter (AC2)`
- `QueryFilterModelTests.EveryIOrganizationScopedEntity_IsCoveredByTheCentralTenantFilter_WithNoneMissed (AC2)`

**AC3 — a staff user's reachable exercises are org-bounded** (each fixture assigns the human to the OTHER
customer's exercise too, so "assignment alone is no longer sufficient" is what is actually proved)
- `StaffOrganizationBoundaryTests.GetAssignments_OmitsAnExerciseBelongingToAnotherCustomer_EvenWhenAssigned (AC3)`
- `StaffOrganizationBoundaryTests.SetActiveExercise_RefusesAnExerciseBelongingToAnotherCustomer_EvenWhenAssigned (AC3)`
- `StaffOrganizationBoundaryTests.StaffLogin_RefusesAnExerciseBelongingToAnotherCustomer_EvenWhenAssigned (AC3)`
- `StaffOrganizationBoundaryTests.StaffLogin_DoesNotReHomeAnExistingStaffHumanOntoTheExercisesCustomer (AC3)`
- `StaffOrganizationBoundaryTests.StaffLogin_EmitsAFailureTelemetryEvent_ForTheCrossCustomerRefusal (AC3, XC-004)`
- `OrganizationIsolationTests.StaffUsersReachableExercises_AreBoundedByTheirOwnOrganization (AC3)`
- `OrganizationIsolationTests.StaffUserWithNoRow_ReachesNoExercisesAtAll_RatherThanAllOfThem (AC3)`
- `BootstrapOrganizationTests.Bootstrap_ProvisionedStaffUser_JoinsTheExercisesOrganization (AC3)`

**XC-001 — cross-org access fails closed** (each carries an `IgnoreQueryFilters`/unbounded control, so a zero
is the door closing rather than an empty table)
- `OrganizationIsolationTests.ExerciseQuery_InOrganizationX_ReturnsNoneOfOrganizationYsExercises (XC-001)`
- `OrganizationIsolationTests.AccountQuery_InOrganizationXsExercise_ReturnsNoneOfOrganizationYsAccounts (XC-001)`
- `OrganizationIsolationTests.UnresolvedOrganization_SeesZeroPersonaTemplates_NeverEveryCustomers (XC-001)`
- `OrganizationIsolationTests.UnresolvedOrganization_SeesZeroExercises_ThroughTheResolutionConstraint (XC-001)`
- `OrganizationIsolationTests.CrossOrganizationIdorByExerciseId_FailsClosed (XC-001)`
- `OrganizationIsolationTests.CrossOrganizationAggregateCount_DoesNotLeakTheOtherCustomersSize (XC-001)`

**XC-002 — the tenant never reaches a participant surface**
- `OrganizationIsNotWireVisibleTests.NoDto_ExposesTheOrganizationTenantOnTheWire (XC-002)`
- `OrganizationIsNotWireVisibleTests.TheOrganizationEntity_IsNeitherExerciseScopedNorOrganizationOwned_BecauseItIsTheTenantRoot (XC-002)`
- `OrganizationIsNotWireVisibleTests.TheOrgOwnedEntitySet_IsExactlyTheStaffAndPlatformTier_WithNoParticipantContentOnIt (XC-002)`

**The exercise axis is unweakened** (the always-Critical guarantee, re-proved with the tenant tier in place)
- `OrganizationIsolationTests.TwoExercisesInTheSAMEOrganization_AreStillFullyIsolatedFromEachOther (COR-001)`
- `QueryFilterModelTests.EveryExerciseScopedEntity_StillHasItsExerciseFilter_AfterTheTenantAxisLanded (COR-001)`
- `QueryFilterModelTests.TheTwoAxesAreSeparatelyKeyed_SoNeitherCanSilentlyReplaceTheOther (COR-001)`
- The whole pre-existing `QueryFilterIsolationTests` suite still passes; see "Existing tests touched" below.

**The forgot-to-scope guard** (the opt-in half of the mechanism)
- `OrganizationScopeSweepTests.EveryUnfilteredOrgOwnedRead_IsEitherTenantBoundedOrExplicitlyExempted`
- `OrganizationScopeSweepTests.TheExemptionInventory_IsPinned_SoANewUnboundedReadCannotSlipInSilently`
- `OrganizationScopeSweepTests.EveryExemptionMarker_CarriesAWrittenJustification_NotJustAReasonCode`
- `OrganizationScopeSweepTests.NoProductionCodeReachesAnOrgOwnedEntityThroughSetOrRawSql`
- `OrganizationScopeSweepTests.TheSweptEntitySet_IsTheUnfilteredOrgOwnedOne_SoTheGuardCannotQuietlyCoverNothing`

### Existing tests touched (called out deliberately — an edited isolation test is a red flag)
Two pre-existing assertions in the exercise-axis suite were narrowed, and **only** because "this entity has no
query filter at all" stopped being the right sentence once a second axis existed. Neither weakens the exercise
axis; both were re-pointed at it explicitly:
- `QueryFilterModelTests.NonScopedEntity_HasNoGlobalQueryFilter` → `…_HasNoExerciseGlobalQueryFilter`:
  `GetDeclaredQueryFilters().Should().BeEmpty()` → `FindDeclaredQueryFilter(null).Should().BeNull()`.
  `PersonaTemplate` now legitimately carries the org filter under its own key; the exercise axis is the
  anonymous (null) key, and asserting *that* is what the test was always for.
- `QueryFilterIsolationTests.NonScopedEntities_AreNeverFiltered_RegardlessOfScope` →
  `…_AreNeverExerciseFiltered_…`: the read now binds the template's OWN tenant, so the only thing that could
  hide the row is the exercise axis — which is the property under test.
- Everything else in the diff is mechanical seeding (`OrganizationId = …` on `Exercise`/`StaffUser`/
  `PersonaTemplate` fixtures, forced by the write guard) plus a `StaffUser` row added wherever a host stubbed
  a staff session over a dangling `StaffUserId` — see `Helpers/StaffTenantSeed.cs` for why that was a fixture
  defect rather than a behaviour change.
