# Story: OrgAdmin surface family

**Feature:** Exercise lifecycle administration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Backend built — frontend routing outstanding, awaiting Tier-2 sign-off
**Requirements:** COR-076  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** fullstack  ·  **Review:** Tier-2 (new authorization branch)

> **Backend built:** `orgAdmin` is now a real server-side role with its own authorization filter
> (`OrgAdminAuthorizationFilter`) and its own org-scoped read (`GET /api/org/staff-assignments`).
> **`RoleAwareEntry`'s routing branch — the load-bearing edit this story names — is NOT built**, so an
> `orgAdmin` who logs in is STILL redirected to login by the frontend. AC1 and AC3 stay open.

## Context
`core/auth/roles.ts` has said this since it was written: `orgAdmin` "belongs to neither [`STAFF_ROLES`
nor `PARTICIPANT_ROLES`] — org administration is a third, separate surface family… so callers that
need 'is this an org-admin' should compare the role directly (`role === 'orgAdmin'`), not infer it
from the absence of the other two sets." `identity-auth-roles/01-roles.md`'s own AC1 has never been
tickable for exactly this reason: "...vs org administration" is part of that AC, and the story's own
status note says plainly "the org-admin surface itself… none of that exists yet."

It still doesn't. Read literally, `RoleAwareEntry.tsx`'s `RoleRouter` has three branches —
`isParticipantRole`, `isStaffRole`, and a fallback:

```
// orgAdmin (a separate surface family, roles.ts) or any unexpected role:
// fail closed. Never a default surface, never a cross-world surface (XC-002).
return <Navigate to={LOGIN_PATH} replace />
```

`isStaffRole()` checks membership in `STAFF_ROLES = ['controller', 'evaluator', 'planner']` —
`orgAdmin` is deliberately not in that list (see the module header for why), so an `orgAdmin`
session hits neither the participant branch nor the staff branch and falls straight through to the
comment above: **an OrgAdmin who logs in today is redirected back to the login page.** The role
exists in the type system, in the session, and in `canWriteInSim()`'s permissive default — but has
no surface to land on. This story is what closes that gap.

## What the OrgAdmin surface family *is*
Organization-scoped administration, distinct from both existing surface families:
- **Not participant** — obviously; OrgAdmin never touches the fiction.
- **Not one of the three existing staff surfaces** (`controller`/`evaluator`/`planner`) —
  those operate **inside** one active exercise (post-as-persona, monitor, configure). OrgAdmin
  operates **above** the exercise: which exercises exist for this organization (story 02), and
  (Phase-1 minimum) who on staff has a `StaffAssignment` to which of them. It does not compose the
  conduct surfaces or the exercise's content in any way.
- **Visually still the staff world** — there is no third *visual* world in Pulse (D0 §2 only
  defines participant/staff); "a third, separate surface family" in `roles.ts` describes a third
  **authorization/routing** family, not a third design language. OrgAdmin renders in COBRA, exactly
  like the other three staff surfaces, and must still pass the same thumbnail-distinguishability
  hard gate (never confusable with a participant view, XC-002).
- **Distinct from COR-018's org-account operation.** Posting "as Fulton County EM" is in-fiction
  content attribution by a participant/persona operator (`identity-auth-roles/09`); OrgAdmin is
  platform tenancy administration. The two share the word "organization" and nothing else — this is
  the same distinction `exercise-isolation/11`'s own header already draws for the Organization
  entity vs. COR-018, restated here because `roles.ts`'s `orgAdmin` is the role most likely to get
  confused with it.

## Acceptance Criteria
- [ ] ~~Given an authenticated `orgAdmin` session, when they enter the app, then they reach a real
      OrgAdmin surface~~ — **not** the fail-closed redirect to login `RoleAwareEntry`'s current
      fallback branch applies to every `orgAdmin` session today. **Partial (backend only).** The SERVER
      side is real: an `orgAdmin` session is minted through the existing staff identity path, is recognised
      distinctly from the three `STAFF_ROLES`, and reaches two org-scoped reads that no other role can fully
      reach. The **client-side routing branch is not built**, so an `orgAdmin` still lands on the login
      redirect. This AC closes when `RoleAwareEntry` gains its fourth arm.
- [x] **(data only)** The OrgAdmin surface's Phase-1 minimum content is: the org-scoped exercise
      list/management view (story 02) and an org-scoped view of staff assignments (which staff humans have a
      `StaffAssignment` to which of the organization's exercises) — read/administer, not the full
      staff-invitation/user-lifecycle workflow, which is a later-phase stub (see Out of Scope).
      **Partial:** BOTH reads exist and are org-bounded (`GET /api/org/exercises`,
      `GET /api/org/staff-assignments`); the surface that composes them is not built. "Read" is built;
      "administer" (mutating an assignment) is not, and no AC in this story asks for a write.
- [ ] ~~The OrgAdmin surface renders in the same COBRA staff visual system as the other three staff
      surfaces and passes the same thumbnail-distinguishability hard gate (never confusable with a
      participant view, `SHELL-CONTRACT.md` §4).~~ **Not built — frontend only.**
- [ ] ~~`RoleAwareEntry`'s routing is extended so `orgAdmin` is a real, reachable branch~~
      **Not built — frontend only; this is the story's load-bearing edit and it is outstanding.** Original
      wording preserved below. — either by
      widening the existing `staffSurfaces` prop's key type (today `'controller' | 'evaluator' |
      'planner'`) to include `orgAdmin`, or by adding a parallel, explicitly-named prop for it — the
      requirement is that the fallback comment's "or any unexpected role: fail closed" branch stops
      matching `orgAdmin` specifically, without weakening that fallback for any role that is
      genuinely unexpected.
- [x] **(backend)** Given a Controller, Evaluator, or Planner session, when they attempt to reach the
      OrgAdmin surface, then they are refused — OrgAdmin is its own gated family, not a superset any other
      staff role can walk into. Enforced server-side by `OrgAdminAuthorizationFilter.OrgAdminOnly`
      (`403` for all three), which is the half that actually matters: a client-side route guard alone would
      leave the data one `curl` away.

### Cross-cutting
- [x] **Isolation (XC-001, org axis):** the OrgAdmin surface's every read/write is scoped to the
      caller's own organization (composes story 02's fail-closed AC directly).
- [ ] ~~**Accessibility (NFR-001):** keyboard-operable, WCAG 2.1 AA, consistent with every other staff
      surface.~~ **Not built — frontend only.**

## Out of Scope
Full organization lifecycle management (creating new organizations, org profile/billing, inviting
brand-new staff humans from scratch) — later-phase stub, not built now; the exercise list content
itself (story 02); exercise creation itself (story 01); any change to `STAFF_ROLES`/
`PARTICIPANT_ROLES` in `roles.ts` (orgAdmin stays deliberately outside both, per that module's own
documented rationale — this story gives it a surface, it does not fold it into either existing
role group); COR-018's org-account operation (`identity-auth-roles/09`) — explicitly a different
concern, see above.

## Technical Notes
Fullstack. Frontend: the `RoleAwareEntry.tsx` extension is the load-bearing edit — read its module
header closely before changing the `RoleAwareEntryProps` shape; `RoleRouter`'s literal-narrowing
trick (`role === 'controller' || role === 'evaluator' || role === 'planner' ? staffSurfaces[role] :
undefined`) will need a fourth arm or an equivalent restructure that still satisfies the "surface
with no entry here fails closed" contract for a role with no registered surface. The concrete
`OrgAdminWorkspaceRoute` composition (mirroring `PlannerWorkspaceRoute`'s shape in `App.tsx`) is an
orchestrator-owned composition-root edit, per house convention. Backend: an authorization check that
recognizes `orgAdmin` distinctly from the three `STAFF_ROLES` (do not accidentally fold it into an
existing staff-role check — several existing endpoints, per `exercise-configuration/feature.md`'s
open question (a), already gate on "any staff session" without inspecting role; this story must not
repeat that gap for its own new endpoints). See implementation.md (story 03).

## Dependencies
`exercise-isolation/11` (`Organization` entity — hard prerequisite, in parallel); `identity-auth-
roles/01` (role vocabulary — this story is what finally lets that story's AC1 "…vs org
administration" clause be ticked); `app-shell/01` (`RoleAwareEntry`, Complete — this story extends
it, does not replace it); story 02 (the exercise-list content this surface's Phase-1 minimum
composes).

## Built as (backend)
`orgAdmin` existed only in `core/auth/roles.ts` before this: nothing server-side minted, stored, validated or
recognised it, and `AccountFieldRules` explicitly rejected it (correctly — it is not a participant role).
What is now real:

- **`ExerciseAdminRoles`** — the first server-side home for the literal, with TWO deliberately
  NON-NESTING sets: `ExerciseAdministrators` (`planner` + `orgAdmin`, stories 01/02) and
  `OrganizationAdministrators` (`orgAdmin` alone, this story). The asymmetry on `planner` IS the separation;
  making one contain the other would silently delete AC5 while every "orgAdmin can reach it" test stayed
  green, so a test asserts the non-nesting directly.
- **`OrgAdminAuthorizationFilter`** — a sibling of `EngineCockpitStaffAuthorizationFilter` /
  `EngineCockpitControllerRoleFilter`, not a reuse. Those two ask "is this caller assigned to the
  CURRENTLY-RESOLVED exercise, holding role X on it" — the right question for a surface inside one exercise
  and the wrong one here, because an org-admin administers runs they hold no assignment on and a
  just-created exercise has none. This filter gates on the caller's session ROLE and their server-resolved
  TENANT, and reads no exercise scope at all.
- **`GET /api/org/staff-assignments`** — AC2's second Phase-1 read, and the only endpoint in the codebase
  gated on `orgAdmin` alone. Without it the new authorization branch would have had no consumer and AC5
  would have been untestable on the server.
- **No global super-admin.** Every check answers "may this role act WITHIN the caller's own organization";
  the organization always comes from `IOrganizationContext`, never from the role. Asserted structurally by
  `ExerciseAdminRolesTests.NoRoleSet_IsAWildcard_SoNoGlobalSuperAdminExists`.

**How an `orgAdmin` session is minted:** through the existing staff identity path, unchanged —
`StaffLoginService` copies `StaffAssignment.Role` onto the session verbatim, so an `orgAdmin` assignment
yields an `orgAdmin` session with no new auth code. Provisioning the FIRST org-admin of a new organization
remains out of scope (story 01: "organizations and their first OrgAdmin are provisioned by Dynamis staff");
see "Known gaps" below — the ops bootstrap seam does not yet accept the role, deliberately.

## Tests
All real-SQL tests are `[RequiresDockerFact]` and were **run** against LocalDB, not skipped; each was
**neutered and watched go red**. The `RoleAwareEntry` routing half has no test here because it has no code
here.

**AC1 (backend half) — an `orgAdmin` session reaches a real org-scoped surface**
- `OrgAdminSurfaceFamilyTests.OrgAdminSession_ReachesBothPhase1Reads_NotAFailClosedNothing (AC1, AC2)`

**AC2 — the two Phase-1 reads, both org-bounded**
- `OrgAdminSurfaceFamilyTests.StaffAssignments_ShowOnlyTheCallersOrganization_NeverAnotherCustomersRoster (AC2, XC-001)`
- `OrgAdminSurfaceFamilyTests.StaffAssignments_HideAForeignHumanAssignedToOurOwnExercise_BecauseBothJoinsAreBounded (AC2, XC-001)`
- `OrgAdminSurfaceFamilyTests.StaffAssignments_RoundTripTheOrgAdminRoleLiteral_Verbatim (AC2)`
- story 02's `ExerciseListEndpointTests` for the exercise-list half.

**AC5 — the three staff roles are refused**
- `OrgAdminSurfaceFamilyTests.StaffAssignments_AsPlanner_IsRefused_SoOrgAdminIsNotJustABiggerStaffRole (AC5)`
  — the planner case is the one that proves this is a separate family and not a bigger staff role.
- `OrgAdminSurfaceFamilyTests.StaffAssignments_AsController_IsRefused (AC5)`
- `OrgAdminSurfaceFamilyTests.StaffAssignments_AsEvaluator_IsRefused (AC5)`
- `OrgAdminSurfaceFamilyTests.StaffAssignments_WithNoSession_IsUnauthorized (AC5)`

**The role vocabulary itself (model-only, plain `[Fact]`)**
- `ExerciseAdminRolesTests.TheOrgAdminLiteral_IsTheFrozenCamelCaseFrontendVocabulary`
- `ExerciseAdminRolesTests.TheOrgAdminFamily_AdmitsOrgAdminAlone_AndNoneOfTheThreeStaffRoles (AC5)`
- `ExerciseAdminRolesTests.TheExerciseAdministratorSet_IsPlannerAndOrgAdmin_AndNothingElse`
- `ExerciseAdminRolesTests.TheTwoRoleSets_DoNotNest_SoOrgAdminIsASeparateFamilyAndNotABiggerStaffRole (AC5)`
- `ExerciseAdminRolesTests.RoleMatching_IsCaseInsensitive_ButTheCanonicalLiteralStaysCamelCase`
- `ExerciseAdminRolesTests.NoRoleSet_IsAWildcard_SoNoGlobalSuperAdminExists`
- `ExerciseAdminRolesTests.OrgAdmin_IsStillRejectedAsAParticipantAccountRole (XC-002)`
- `ExerciseAdminRolesTests.OrgAdmin_IsNotTheEngineCockpitControllerRole`

**XC-002 — the tenant never reaches the wire**
- `ExerciseAdminRolesTests.NoDtoInThisSlice_ExposesTheCustomerTenant`
- `ExerciseAdminRolesTests.TheStaffCallerType_CarriesTheTenantButIsNotAWireShape`
- the repo-wide `OrganizationIsNotWireVisibleTests` still passes unmodified.

## Known gaps (backend)
1. **No production path provisions the FIRST `orgAdmin` of an organization — AND an organization with zero
   exercises has no path to authenticate ANY `orgAdmin` at all, seeded or not.** `StaffLoginService`
   requires an existing `StaffAssignment` **on a specific exercise**; story 01's create copies the
   creator's own role; and `BootstrapService.CanonicalStaffRoles` accepts only
   `controller`/`evaluator`/`planner`. The dev/UAT-only seeder mentioned below only helps an organization
   that already has at least one exercise to attach a seeded assignment to — an organization with genuinely
   zero exercises is chicken-and-egg: the role whose own job includes creating that first exercise (COR-074)
   cannot itself sign in until one exists, because `Session.ExerciseId` / `SessionIssueRequest.ExerciseId` /
   `AuthenticatedSession.ExerciseId` are all non-nullable and the login funnel rejects before role/assignment
   are ever considered when no exercise resolves. **This full authentication-path gap is owned by
   `docs/features/identity-auth-roles/15-org-level-authentication.md` (COR-077, new, Not Started)** — that
   story owns the login funnel + session-shape fix; this feature owns only the surface the fixed session
   would reach. Today an org-admin has to be seeded directly into the database, and only for an organization
   that already has an exercise to seed the assignment against.
2. **Assignment ADMINISTRATION is read-only.** AC2 says "read/administer"; only the read is built, and no AC
   describes a write.
