# Feature: Exercise lifecycle administration

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.7
**World:** staff  ·  **Issue:** —

## Summary
"Create an exercise" has never had a requirement ID, a story, or a customer-facing endpoint. The
only creation language anywhere in the corpus is an un-IDed UX narrative sentence
(`docs/01-platform-core-isolation.md` §5: "From the staff console: create exercise → configure
world → …"), and `COR-045` (exercise duplication, `docs/features/exercise-build-golive/
06-exercise-duplication.md`) presupposes a create path that has never existed as a requirement.
The only thing that currently creates an `Exercise` row is `POST /api/ops/bootstrap-exercise`, whose
own doc comment says it "MUST NOT be reachable in a real customer-facing deployment" — it exists
solely to solve the empty-database chicken-and-egg problem for a fresh backend, gated by a
deployment secret, not a role. This feature gives exercise creation its first real requirement IDs,
its first real story, and its first real staff-facing surface — plus the org-scoped exercise list a
Planner/OrgAdmin needs to find and manage what they've created, and the OrgAdmin surface family
`core/auth/roles.ts` already names but nothing yet implements.

## Why a new folder, not `exercise-build-golive`
`exercise-build-golive` (COR-040…045) is about the Build→Staged→Live phases of an **exercise that
already exists**: the build workspace, preview-as-participant, the readiness dashboard, the two
gated go-live moments, content lock, and duplication. Every one of its stories assumes an `Exercise`
row to operate on. Exercise creation is prior to all of that — it is the entity's genesis — and it
drags in a different kind of scope entirely: the `Organization` tenant tier, hostname allocation
(COR-008), auto-assigning the creator a `StaffAssignment`, and an entirely new role-gated surface
family (OrgAdmin) that `exercise-build-golive` has no reason to own. Folding creation into that
feature would make its "Requirements covered" span two epics' worth of concerns (world-authoring
behavior vs. platform tenancy/identity) and would bury the OrgAdmin surface family inside a feature
named for a different phase of an exercise's life. A sibling feature keeps `exercise-build-golive`'s
scope honest and gives the org tier work now landing (see Dependencies) a home that matches its
actual size. `exercise-build-golive/06`'s Dependencies section is updated to point at this feature's
story 01 as its prerequisite.

## Requirements covered
COR-074 (exercise creation), COR-075 (exercise list & management), COR-076 (OrgAdmin surface
family). See `docs/01-platform-core-isolation.md` F1.7 for the full requirement text.

## Design references
None — this feature has no design brief; it is filed directly from the epic (F1.7) and the backend
reality (`Pulse.WebApi/Features/Ops/Bootstrap/`, `Data/Entities/Exercise.cs`,
`Data/Entities/StaffAssignment.cs`). It composes `staff-navigation`'s registry (a surface here is a
registry entry, not a bespoke route) and reuses the COBRA staff idiom throughout (no new visual
system).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Exercise creation (backend endpoint + Planner/OrgAdmin surface) | COR-074 | Backend built — frontend outstanding | — |
| 02 | Exercise list & management (org-scoped) | COR-075 | Backend built — frontend outstanding | — |
| 03 | OrgAdmin surface family | COR-076 | Backend built — `RoleAwareEntry` routing outstanding | — |

> **Backend pass landed 2026-08-02** (Tier-2 sign-off outstanding on all three). Three org-tier endpoints
> exist and are wired into `Program.cs`: `POST`/`GET /api/org/exercises` and
> `GET /api/org/staff-assignments`. `orgAdmin` is a real server-side role for the first time, with its own
> authorization filter. `IOrganizationContext` gained the production writer it never had (reviewer WR-006),
> and `Organization` itself joined the org-scope sweep (WR-008). **No frontend surface is built** — an
> `orgAdmin` who logs in is still redirected to login by `RoleAwareEntry`. See implementation.md.

## Dependencies
**Hard prerequisite — the `Organization` tenant tier.** All three stories depend on the
`Organization` entity (`docs/01-platform-core-isolation.md` §3.1) existing as a real, persisted
tenant boundary with `OrganizationId` on `Exercise` and on staff access. That tier is tracked at
`docs/features/exercise-isolation/11-organization-tenant-boundary.md`, whose own text defers it to
"a dedicated wave gated on multi-customer go-live" (Option B, chosen and recorded there). **That
posture is superseded for this feature specifically**: per current direction, the org tier is being
pulled forward now, in parallel, as the explicit prerequisite for exercise creation/management/
OrgAdmin — a backend effort is building it alongside this backlog. Do not start any story here
before confirming `exercise-isolation/11`'s actual current state (its own file, not this note, is
authoritative) — none of these three stories can land ahead of it. Also depends on:
`identity-auth-roles/01` (roles, including `orgAdmin` — In Progress, blocked partly on this
feature); `identity-auth-roles/05` (`StaffUser`/`StaffAssignment`, Complete — story 01 auto-assigns
one); `exercise-isolation/08` (per-exercise hostname resolution, Complete — story 01 allocates into
the same `Hostname` column); `exercise-configuration/01` (the `Exercise` entity's settings columns,
merged — a newly-created exercise starts with these at their documented defaults);
`staff-navigation/01` (the surface registry stories 02/03 register their surfaces into).
`exercise-build-golive/06` (exercise duplication, COR-045) depends on this feature's story 01: you
cannot duplicate what nothing can create.

## Related — the empty-organization authentication gap (owned elsewhere)
Story 03's own "Known gaps" section names it in full: an organization with **zero** exercises has no path
to authenticate an `orgAdmin` at all, because `StaffLoginService.LoginAsync` requires a `StaffAssignment`
on a specific `Exercise`, and the role whose own job includes creating that first exercise (COR-074) cannot
itself sign in until one exists. That gap is **owned by
`docs/features/identity-auth-roles/15-org-level-authentication.md` (COR-077, new, Not Started)** — the
login funnel and the `Session`/`SessionIssueRequest`/`AuthenticatedSession` exercise-scope shape are that
feature's surface, not this one's. This feature owns COR-074/075/076 — the org-tier surface an org-level
session would reach — not the mechanism that mints one.

## Design notes
Staff world throughout — none of this is ever participant-reachable (XC-002: no participant surface
exposes exercise selection or the organization concept, full stop). The bootstrap seam
(`POST /api/ops/bootstrap-exercise`) stays exactly what it is — a secret-gated, deployment-time,
empty-database escape hatch — and is explicitly **not** touched, deprecated, or replaced by this
feature; the two exist for different reasons and story 01 must not weaken the bootstrap endpoint's
gating while building the real path. Every write here is `IExerciseScoped`-adjacent tenancy
plumbing, not participant content, so XC-004 telemetry is not the primary lens (no post/reply/
reaction/view/DM/login is emitted by creating an exercise) — but story 01's creation action is still
an auditable staff action and should be logged the same way other staff actions are
(`ParticipantAdminFlyout`'s `actor.kind: 'system'` + `actingHumanId` precedent). Accessibility
(NFR-001) applies to every staff surface here exactly as it does everywhere else in the staff world.
