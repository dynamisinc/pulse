# Implementation: Exercise isolation

> The platform foundation. Mostly backend/infra. The `Pulse.WebApi` host, `PulseDbContext`, the read-side
> global query filter (story 01, #44), and the `IExerciseContext`/`ExerciseContext` scope seam all landed
> in **Phase B0** (`backend-host`, merged). **Phase B2 (`docs/BACKEND_ROADMAP.md` §4)** adds story **08**'s
> host → exercise resolution — the participant, pre-auth **populator** of the `ExerciseContext` scope seam
> — plus the frozen `GET /exercise-context` resolver, and turns stories **04**/**05** into `frontend`
> make-real stories on the now-live session/exercise/`StaffAssignment` seams. The frontend consumes a
> scoped API and must never construct a cross-exercise request.

## Per-story tech notes

| Story | Stack | Approach | Key files (owns) | Exports / seams (that others import) |
|-------|-------|----------|------------------|--------------------------------------|
| 01 Central scoping *(Complete, #44)* | backend | Read-side EF global query filter extending `PulseDbContext.OnModelCreating`; fail-closed. | `Data/PulseDbContext.cs` filter (shipped) | the scoped `DbContext` behavior |
| 02 Scoped surfaces + media | backend | Access-checked, opaque media URLs; scoping on derived surfaces. | (backend) media serving + URL signing | media URL helper |
| 03 Multi-instance personas | backend | Template↔instance split w/ per-instance exercise-scoped state. | (backend) `Persona`/`PersonaTemplate` model | Persona instance contract |
| 04 No exercise selection | **frontend (B2 make-real)** | Participant landing route guard on the **live** `useSession()`/`useExerciseContext()`; participant/PIO + resolved scope → landing; staff/unresolved/expired → fail-closed; read-only → All Posts. Composed by `app-shell/01`. | `src/frontend/src/features/participant-shell/*` route guard (or `core/exerciseContext` guard) | the participant landing guard |
| 05 Staff switcher | **frontend (B2 make-real)** | Staff-only exercise selector on **live** `StaffAssignment`: reads `GET /api/staff/assignments`, switches via `POST /api/staff/active-exercise`. COBRA, staff-surfaces-only. | `features/staff/components/ExerciseSwitcher.tsx` | `ExerciseSwitcher` (composed by `app-shell/01`) |
| 06 Archived separation | backend | Lifecycle-status exclusion from live queries + export set. | (backend) archive filter | — |
| 07 Isolation suite | fullstack (test) | Cross-exercise + stored-XSS attempts on each participant endpoint; **extended by every B2 story** (host-resolution, accounts, read-only session, switch-re-scopes). | `**/*.isolation.test.ts` (+ backend suite) | the standing suite |
| 08 Hostname → resolution **[Tier-2]** | **fullstack (B2)** | Host→exercise map + `UseExerciseResolution()` middleware that **sets `ExerciseContext.CurrentExerciseId`** (anonymous/pre-auth participant populator); unknown host fails closed; serves `GET /api/exercise-context` (frozen `ExerciseScope`); flips `USE_MOCK_EXERCISE_CONTEXT`. Owns the **precedence model**. | `Features/ExerciseResolution/` (host map, `UseExerciseResolution()`/`AddExerciseResolution()`, `ExerciseContextEndpoints`); + infra (cert/DNS); + `USE_MOCK_EXERCISE_CONTEXT` flip | `GET /api/exercise-context`; the host→exercise map; the middleware; the scope-seam write (participant arm) |
| 09 Network readiness | frontend | Self-test page + allowlist doc. | `features/connectivity/pages/SelfTest.tsx` | — |
| 10 Mock context provider *(Complete, #211)* | frontend | Mock resolver behind the axios client; provider + hook only. | `core/exerciseContext/exerciseContext.tsx` (shipped) | `ExerciseContextProvider`, `useExerciseContext()` |
| 11 Organization tenant boundary **[Tier-2, deferred → multi-customer go-live]** | backend | The customer tenant tier ABOVE the exercise: `Organization` entity + `Exercise.OrganizationId` + org-scoping of `PersonaTemplate`/cast/accounts/staff. Deferred (Option B) — built in a dedicated wave gated on multi-customer go-live; records the gap + the resolution. Layers over the exercise filter, does not replace it. | (when built) `Organization` entity + `PulseDbContext` config/migration + the second scoping axis | the customer tenant scope |

## Reuse map
- **B0 backend seams (real C# in `src/Pulse.WebApi/`, merged):**
  - `Data/ExerciseContext.cs` — the **settable, Scoped `CurrentExerciseId`** — the scope-resolution seam
    story **08** WRITES from the host (participant, pre-auth); identity-auth-roles/03 (session) and /05
    (staff active-exercise) write it too. `Data/IExerciseContext.cs` — the get-only read side
    `PulseDbContext` consumes.
  - `Data/PulseDbContext.cs` — the read-side global query filter (story 01) + write-guard; every scoped
    query reads the `ExerciseContext` story 08 populates. `Data/IExerciseScoped.cs` — the marker. **Note
    (story 11):** `PersonaTemplate` is deliberately NOT `IExerciseScoped` (a cross-exercise shared library,
    XC-005) and is therefore **globally shared today** — correct within one customer, but a cross-customer
    leak once the `Organization` tenant tier exists; story 11 scopes it to the owning org.
  - `Data/Extensions/ExerciseScopingServiceCollectionExtensions.cs` — `AddExerciseScoping()` (wired).
  - `Features/{Social,Realtime,Telemetry}/*` — the minimal-API endpoint pattern story 08's
    `ExerciseContextEndpoints` follows (`AddX()`/`MapX()`, route base `/api`).
  - `Program.cs` — orchestrator-owned; story 08 exports `AddExerciseResolution()` + `UseExerciseResolution()`
    for the orchestrator to wire (middleware ordering below).
- **Frozen frontend seams (client contract — story 08 makes real; stories 04/05 consume live):**
  - `core/exerciseContext/exerciseContextResolver.ts` — `resolveExerciseContext(): Promise<ExerciseScope>`
    → `GET /exercise-context`; single flip `USE_MOCK_EXERCISE_CONTEXT` (story 08). Real
    `/api/exercise-context` MUST return `{ exerciseId, exerciseName, timeZone, status }` exactly. **Precedent:
    a participant request never carries a client-supplied `exerciseId` — scope is server-side.**
  - `core/exerciseContext/exerciseContext.tsx` — `ExerciseContextProvider`/`useExerciseContext()`.
  - `core/auth/session.tsx` + `roles.ts` (live via identity-auth-roles/03) — stories 04/05 route on them.
  - `App.tsx` — mounts the providers; the nav route-table replacement is `app-shell/01` (orchestrator edit).
- COBRA theme + `@/theme/styledComponents` (staff switcher, story 05); `testing-agent` isolation-suite
  conventions (story 07); Cadence multi-tenant query-filter pattern.

### The scope-resolution seam & precedence (owned by story 08, reconciled with identity/03 + /05)
`ExerciseContext.CurrentExerciseId` is one Scoped, settable value with three populators:
**authenticated session (identity/03, incl. staff active-exercise identity/05) > host resolution (this
story 08, anonymous/pre-auth participant) > unset (fail-closed → `Guid.Empty` → zero rows).** `Program.cs`
middleware order: `UseExerciseResolution()` (08) runs **before** the auth/session layer (03), so the
session's write overrides the host's provisional one. A participant session whose exercise ≠ the host's
resolved exercise fails closed. Endpoint ownership is clean: **`/exercise-context` is this story's;
`/session` is identity-auth-roles/03's** — each frozen resolver has exactly one owner.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 10 Mock context provider *(Complete)* | frontend | `exerciseContext.tsx` | none | — | 0 | S |
| 01 Central scoping *(Complete)* | backend | `PulseDbContext` filter | `backend-host/02` (B0) | 03 | 1 | L |
| 03 Multi-instance personas | backend | Persona model | Exercise entity | 01 | 1 | M |
| 02 Scoped surfaces + media | backend | media serving/URL | 01 | — | 2 | M |
| 08 Hostname → resolution **[Tier-2]** | **fullstack (B2)** | `Features/ExerciseResolution/` + infra + `USE_MOCK_EXERCISE_CONTEXT` flip | `backend-host/02` + `AddExerciseScoping` (B0) | identity-auth-roles/05 (same B2 wave 1, other feature) | 2 (B2 wave 1) | L |
| 06 Archived separation | backend | archive filter | 01; lifecycle | 07 | 3 | S |
| 07 Isolation suite | fullstack (test) | isolation tests | 01, 02, **08** | 06 | 3 | M |
| 04 No exercise selection | **frontend (B2)** | participant landing guard | live 03 + 08 | 05; `app-shell/01` | 4 (B2 wave 4) | S |
| 05 Staff switcher | **frontend (B2)** | `ExerciseSwitcher.tsx` | live 08 + identity/05 (`StaffAssignment`) | 04; `app-shell/01` | 4 (B2 wave 4) | S |
| 09 Network readiness | frontend | SelfTest page | 08; transports | — | 4 | S |

> The "Wave" column carries each story's original intra-feature sequence; the parenthetical **(B2 wave N)**
> marks the cross-feature Phase-B2 wave the roadmap sequences it into (08 = B2 Wave 1 seam; 04/05 = B2 Wave
> 4 with `app-shell/01`). Story 08's B2 backend build depends only on the merged B0 seams; 04/05 depend on
> the live session/exercise/`StaffAssignment` flips.

### Integration seams (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Story 08 exports `AddExerciseResolution()` + `UseExerciseResolution()`; the orchestrator wires them serially. **Ordering:** `app.UseExerciseResolution()` (08) runs **before** the auth/session middleware (identity/03) so the session's scope write takes precedence over the host's (the precedence model above). |
| Frontend mock→live flip | `core/exerciseContext/exerciseContextResolver.ts` (`USE_MOCK_EXERCISE_CONTEXT`) | Story 08 flips this single point live once `/api/exercise-context` is Gate-2 clean; a serial, orchestrator-owned integration edit. `useExerciseContext()` consumers need no change (the `ExerciseScope` shape is unchanged). |
| Frontend route table | `src/frontend/src/App.tsx` | The role-aware route-table replacement that mounts the story-04 guard + story-05 switcher is owned by `app-shell/01`'s Integration seam, not this feature. |
