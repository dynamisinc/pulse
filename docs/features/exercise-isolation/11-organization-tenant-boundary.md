# Story: Organization tenant boundary (customer scoping above the exercise)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Deferred — gated on multi-customer go-live
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

## Acceptance Criteria (draft — apply once the decision selects A or B)
- [ ] Given the two-tier design, when the model is built, then an `Organization` entity exists as the customer
      tenant boundary and `Exercise` carries a non-nullable `OrganizationId` (an exercise belongs to exactly
      one organization).
- [ ] Given org-owned shared assets, when `PersonaTemplate` / cast libraries are queried, then they are scoped
      to the owning organization (not globally shared) — closing the cross-customer leak — while remaining
      shared *across the exercises of that organization* (XC-005 within the org).
- [ ] Given a staff/planner user, when they authenticate, then their reachable exercises and admin surface are
      bounded by their organization; an `OrgAdmin` (COR-010) administers only their own organization.
- [ ] Given the two senses of "org", when this is built, then it does **not** touch the in-fiction org-account
      operation (COR-018 / `identity-auth-roles/09`), which stays a separate content/attribution concern.

### Cross-cutting
- [ ] **Isolation (XC-001 / COR-001):** a cross-**organization** access attempt fails closed (a query in org X
      never returns org Y's exercises, templates, or accounts). Extends the standing suite
      (`exercise-isolation/07`) with a cross-org case — the org tier gets the same fail-closed proof the
      exercise tier has. Modeled either as a second global-filter axis on `PulseDbContext` or as a resolution
      constraint above the exercise scope (the builder decides; document it).
- [ ] **No participant surface** exposes the organization concept (XC-002) — org is a staff/platform tier only.

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
- Integration (once built): a query in organization X returns none of organization Y's exercises,
  persona templates, cast, or accounts (fail-closed cross-org isolation) — added to the standing suite.
- Integration: `PersonaTemplate` is shared across an organization's exercises but not across organizations.
