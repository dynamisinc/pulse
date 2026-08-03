# Implementation: Exercise lifecycle administration

> Bridge between planning and orchestration. All three stories share one hard, serial prerequisite —
> the `Organization` tenant tier (`exercise-isolation/11`) — which is not part of this feature's own
> Wave Plan (it is owned and built by that story's wave). Nothing here can start ahead of it.

## Per-story tech notes

| Story | Approach | Key files | Exports (that others import) |
|-------|----------|-----------|------------------------------|
| 01 exercise-creation | New `Features/ExerciseLifecycleAdmin/` backend slice (creation endpoint, role-gated); a registered staff surface (creation form) | `Pulse.WebApi/Features/ExerciseLifecycleAdmin/ExerciseCreation*.cs`; `features/exerciseLifecycleAdmin/components/CreateExercisePanel.tsx` (naming TBD by builder) | The creation endpoint contract (DTO shapes) — consumed by story 02's list refresh after a create |
| 02 exercise-list-management | Org-scoped `GET` endpoint; a list surface with row actions | `Pulse.WebApi/Features/ExerciseLifecycleAdmin/ExerciseList*.cs`; `features/exerciseLifecycleAdmin/pages/ExerciseListPage.tsx` | `<ExerciseListPage>` — story 03 mounts it as the OrgAdmin surface's Phase-1 content |
| 03 orgadmin-surface-family | Extends `RoleAwareEntry`'s routing to a real `orgAdmin` branch; composes story 02 | edits `features/app-shell/RoleAwareEntry.tsx` (or a documented restructure of its props); `features/exerciseLifecycleAdmin/OrgAdminWorkspaceRoute.tsx` (composition, orchestrator-mounted in `App.tsx`, mirroring `PlannerWorkspaceRoute`) | `OrgAdminWorkspaceRoute` |

Backend: stories 01/02 are `fullstack`; story 03 is mostly frontend routing plus whatever
authorization check its new endpoints (if any, beyond consuming story 02's) need for the `orgAdmin`
role specifically.

## Reuse map
- COBRA theme + `@/theme/styledComponents` — `src/frontend/src/theme/`.
- `RoleAwareEntry` (`features/app-shell/RoleAwareEntry.tsx`) — story 03's load-bearing edit point;
  read its module header in full before touching `RoleAwareEntryProps`.
- `core/auth/roles.ts` — `ExerciseRole`, `useRole()`; `orgAdmin` stays outside `STAFF_ROLES`/
  `PARTICIPANT_ROLES` per that module's documented rationale.
- `staff-navigation/01`'s surface registry — the seam stories 01/02/03's surfaces register into
  (once that feature lands; if sequenced before it, register a placeholder entry point and migrate).
- `PulseDbContext`, `IExerciseScoped`, the B0 create-then-extend pattern
  (`Pulse.WebApi/Data/`) — the `Organization`/`OrganizationId` columns story 01/02 read/write are
  `exercise-isolation/11`'s, not reinvented here.
- Shared axios client (`core/services/api.ts`); React Query hooks pattern.
- FontAwesome icons (`@fortawesome/react-fontawesome`) — never `@mui/icons-material`.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 exercise-creation | fullstack | `Features/ExerciseLifecycleAdmin/ExerciseCreation*.cs`; creation surface component | `exercise-isolation/11` (Organization tier — serial, external to this wave plan) | — | 1 | L |
| 02 exercise-list-management | fullstack | `Features/ExerciseLifecycleAdmin/ExerciseList*.cs`; `ExerciseListPage.tsx` | `exercise-isolation/11`; benefits from 01 existing (list has something to show) but is independently buildable against a bootstrap-seeded exercise | 01 (file-disjoint) | 1 | M |
| 03 orgadmin-surface-family | frontend | `RoleAwareEntry.tsx` edit; `OrgAdminWorkspaceRoute.tsx` | 02 (mounts its list as Phase-1 content) | — | 2 | M |

Wave 1 fans out 01 and 02 (different backend slice files, different frontend surfaces — file-
disjoint). Wave 2 is story 03 alone: it both consumes story 02's finished list component and edits
the shared `RoleAwareEntry.tsx`, which is exactly the kind of shared file no other story in this
feature touches, so it is safe to land last without blocking the others.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Frontend composition root | `src/frontend/src/App.tsx` | Mounting `OrgAdminWorkspaceRoute` (story 03) as the concrete surface passed into `RoleAwareEntry`'s widened props, mirroring how `PlannerWorkspaceRoute` was added for the planner role. Orchestrator-only, serial, after story 03's builder branch merges. **Outstanding.** |
| Backend composition root | `Pulse.WebApi/Program.cs` | **APPLIED** — three lines, see below. Guarded by `Features/ExerciseLifecycleAdmin/CompositionRootWiringTests` + `OrganizationResolutionPipelineOrderTests` so this cannot ship merged-but-dead (the #310 → #317 shape). |

#### The three backend composition-root lines, as applied

```csharp
// 1. DI — after AddStaffIdentity()/AddSessions() (convention; ICurrentStaffSessionAccessor is Replace()d,
//    so the ordering is readability rather than correctness).
builder.Services.AddExerciseLifecycleAdmin();

// 2. PIPELINE — ORDER IS LOAD-BEARING. Immediately after UseSessionAuthentication(), before UseAuthorization().
app.UseOrganizationResolution();

// 3. ROUTES — alongside the other staff endpoint mappings.
app.MapExerciseLifecycleAdminEndpoints();
```

**Why line 2's position is load-bearing, in both directions — and why each mistake is silent:**

- **Too early** (above `UseSessionAuthentication()`): `HttpContext.User` is still anonymous, so no tenant is
  ever resolved. Every `/api/org/*` route 401s and every `PersonaTemplate` read quietly returns zero rows —
  registered, mapped, resolvable, and inert. This is the same shape as the `UseExerciseLifecycleGating()`
  mis-order this codebase has already had to guard against.
- **Too late** (after anything that constructs the REQUEST-SCOPED `PulseDbContext`): that context captures
  BOTH scopes once, in its constructor, so a later write cannot change a filter it has already locked in.
  Nothing between `UseExerciseResolution()` and this slot builds that context — the host resolver and the
  session authenticator both use their own throwaway DI scopes — which is exactly why this slot works.
  `OrganizationResolutionMiddleware` follows the same discipline for its own lookup.

`OrganizationResolutionPipelineOrderTests` drives a real request through the real pipeline against real SQL
and asserts BOTH directions (a resolvable tenant serves `200`; an unresolvable one is refused), so neither
mistake can pass.

## What the backend pass actually built (2026-08-02)

| Route | Gate | Story |
|-------|------|-------|
| `POST /api/org/exercises` | `planner` or `orgAdmin` | 01 (COR-074) |
| `GET /api/org/exercises` | `planner` or `orgAdmin` | 02 (COR-075) |
| `GET /api/org/staff-assignments` | `orgAdmin` **alone** | 03 (COR-076) |

Route prefix `/api/org/*`, deliberately not `/api/staff/*`: every existing `/api/staff/*` route is scoped to
the ONE server-resolved exercise, while these span the caller's whole customer tenant. **No org-tier route
takes a route parameter of any kind**, so there is no IDOR surface on the org axis — asserted structurally.

New production files (all under `Pulse.WebApi/`):

| File | Role |
|------|------|
| `Features/ExerciseLifecycleAdmin/ExerciseAdminRoles.cs` | The first server-side home for `orgAdmin`; two deliberately NON-nesting role sets. |
| `Features/ExerciseLifecycleAdmin/StaffCallerContext.cs` | Resolves WHO / WHAT ROLE / WHICH TENANT from the server-issued session alone; memoized per request; fails closed on every branch. |
| `Features/ExerciseLifecycleAdmin/OrgAdminAuthorizationFilter.cs` | The role gate — a sibling of the two engine-cockpit filters, not a reuse (they gate on assignment-to-the-resolved-exercise, which is the wrong question above the exercise). |
| `Features/ExerciseLifecycleAdmin/ExerciseCreationService.cs` | COR-074. One unit of work: exercise + creator assignment + one XC-004 event. |
| `Features/ExerciseLifecycleAdmin/ExerciseListService.cs` | COR-075. `InOrganization(...)`-bounded. |
| `Features/ExerciseLifecycleAdmin/OrgStaffDirectoryService.cs` | COR-076. Bounded on BOTH joins. |
| `Features/ExerciseLifecycleAdmin/ExerciseAdminDtos.cs` | Wire shapes. None carries the tenant (XC-002). |
| `Features/ExerciseLifecycleAdmin/ExerciseLifecycleAdminEndpoints.cs` | `AddExerciseLifecycleAdmin()` / `MapExerciseLifecycleAdminEndpoints()`. |
| `Features/OrganizationResolution/OrganizationResolutionMiddleware.cs` | **The production writer of `IOrganizationContext`** (reviewer WR-006) — see below. |
| `Features/OrganizationResolution/OrganizationResolutionExtensions.cs` | `UseOrganizationResolution()`. |

### `IOrganizationContext` now has a production writer (reviewer WR-006)
Before this pass, nothing in production ever assigned `CurrentOrganizationId`: the org-axis global query
filter matched `Guid.Empty` on every request, so every `IOrganizationScoped` read returned zero rows —
fail-closed and harmless only because nothing read `PersonaTemplate` yet. `OrganizationResolutionMiddleware`
resolves it from the authenticated STAFF caller's own `StaffUser.OrganizationId`, looked up by the
`StaffUser` id on the principal `SessionAuthenticationMiddleware` minted — never from a body, route or query
value. A participant / read-only / anonymous request leaves it UNSET (XC-002: no participant code path
touches the organization concept). It cannot widen the exercise axis: the two axes cover disjoint entity
sets.

`StaffCallerContext` takes its tenant from that same `IOrganizationContext` rather than re-reading
`StaffUsers`. That is deliberate twice over: it makes the request's explicitly-bounded reads and its
globally-filtered reads structurally incapable of disagreeing about the customer, and it makes the
middleware load-bearing — drop it from the pipeline and every org endpoint 401s loudly instead of quietly
serving the wrong thing.

### The org-scope sweep was tightened, not just re-baselined
`OrganizationScopeSweepTests` (`exercise-isolation/11`) changed in three ways, each closing a reviewer
finding:

1. **WR-008 — `Organization` joined the swept set.** The tenant root implements neither marker (correctly:
   its own `Id` IS the scope), so it had **neither** a query filter **nor** sweep coverage. A future
   org-admin "list organizations" read would have disclosed the entire customer roster with nothing going
   red. A new exemption reason, `TenantRoot`, covers by-known-id lookups of that table; ENUMERATING it is
   what must never be unmarked. `BootstrapService.ResolveDefaultOrganizationAsync` — the one reader today,
   a lookup by the fixed `Organization.DefaultOrganizationId` — now carries that marker.
   `ExpectedExemptionCounts["TenantRoot"] = 1`.
2. **S-004 — the marker lookback is now a CONTIGUOUS COMMENT BLOCK, not eight lines.** The old rule let a
   marker written for query A silently exempt an unmarked query B up to eight lines below it, with the
   pinned inventory none the wiser because B was attributed to A's reason. Any intervening line of code now
   ends the block. This is **strictly stronger** and required **no re-baselining**: every pre-existing marker
   was already adjacent to its own statement, which the unchanged counts prove.
3. **`ExpectedExemptionCounts["OwnIdentity"]` 2 → 3** — the one new unbounded read this feature adds:
   `OrganizationResolutionMiddleware`'s lookup of the caller's own `StaffUser` row, which is the read that
   DISCOVERS the tenant and therefore cannot be tenant-bound without a deadlock.

### Schema
One migration, one nullable column: `20260802124443_ExerciseCreatedAt` adds `Exercise.CreatedAt`
(`datetimeoffset NULL`), because story 02's AC2 requires a created date and nothing carried one. Nullable
with no backfill on purpose — see story 02.
