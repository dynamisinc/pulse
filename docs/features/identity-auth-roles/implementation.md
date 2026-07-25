# Implementation: Identity, auth & roles

> Foundation spanning staff + participant worlds. **Phase B2 (`docs/BACKEND_ROADMAP.md` §4)** builds the
> real identity tier on top of the **B0 backend** (`backend-host`, merged): `Pulse.WebApi` host,
> `PulseDbContext`, the `IExerciseContext`/`ExerciseContext` scope seam, `AddExerciseScoping`, and the
> `Features/*` minimal-API endpoint pattern all already exist. The identity provider stays behind an
> interface (COR-014). The frozen frontend seams (`core/auth/session.tsx` + `sessionResolver.ts`,
> `core/auth/roles.ts`) are the client contracts these backend stories fill; story 03's live flip is the
> hinge.

## Per-story tech notes

| Story | Stack | Approach | Key files (owns) | Exports / seams (that others import) |
|-------|-------|----------|------------------|--------------------------------------|
| 01 Roles | frontend (seed landed) | Six-role vocabulary + role-group guards; reads the bound session. | `src/frontend/src/core/auth/roles.ts` (shipped) | `ExerciseRole`, `useRole()`, `isStaffRole`/`isParticipantRole`/`canWriteInSim`, `isExerciseRole` |
| 02 Named accounts | **fullstack** | `Account` entity (**IExerciseScoped**) + bulk CSV import + individual create + participant credential login → mints a story-03 session. Staff-console import panel (COBRA). | `Features/Identity/` account slice (`Account` entity, `PulseDbContext` config + migration, `AccountEndpoints`, `AddParticipantAccounts()`); `features/planner/components/AccountImport.tsx` | `/api/auth/login`, `/api/staff/accounts[/import]`; `Account` (scoped) |
| 03 Sessions | **fullstack** | The hinge: session model + issuance + short-lived/refresh + auth scheme; `GET /api/session` (frozen `Session` shape); binds session↔exercise↔account; **sets `ExerciseContext.CurrentExerciseId` from the session (precedence over host)**. Flips `USE_MOCK_SESSION`. | `Features/Identity/Sessions/` (session model, `SessionEndpoints`, issuance service, `AddSessions()`, auth scheme) | `GET /api/session`, `/api/auth/refresh`, `/api/auth/logout`; the **session-issuance service** 02/05/06 call; the session→scope population |
| 04 Evaluator read-only | backend | Role-level write denial across sim actions; scoped read. | (backend) authz policy | — |
| 05 Provider + staff identity **[Tier-2]** | **backend** | `IIdentityProvider` (+ Dynamis impl); `StaffUser`/`StaffAssignment` entities (**NOT IExerciseScoped** — cross-exercise, COR-005); staff login → session; active-exercise selection **sets the scope seam** (staff arm). | `Features/Identity/` staff slice (`IIdentityProvider`, `DynamisIdentityProvider`, `StaffUser`/`StaffAssignment` + `PulseDbContext` config + migration, `StaffAuthEndpoints`, `AddStaffIdentity()`) | `IIdentityProvider`; `/api/auth/staff/login`, `/api/staff/assignments`, `/api/staff/active-exercise`; `StaffAssignment` (the switcher's data source) |
| 06 Shared read-only **[Tier-2]** | **backend** | `SharedCredential` entity (**IExerciseScoped**); `/api/auth/shared` → view-only session + ephemeral identity; server-side write-path denial. | `Features/Identity/` shared-cred slice (`SharedCredential` entity + config + migration, `SharedCredentialEndpoints`, `AddSharedReadOnly()`) | `/api/auth/shared`; the `isReadOnly` session kind + ephemeral identity |
| 07 Credential lifecycle **[Tier-2]** | **backend** | Rotation w/ grace, immediate revoke (kills all read-only sessions), brute-force lockout, per-IP rate limit; staff-only + logged. | `Features/Identity/` shared-cred lifecycle slice (`SharedCredentialLifecycleEndpoints`, rotation/lockout logic, `AddSharedCredentialLifecycle()`) | `/api/staff/shared-credential/rotate`, `/revoke` |
| 08 Participant admin | *deferred (out of B2)* | COR-017 — staff login-triage panel. Not authored this slice. | — | — |
| 09 Org-account operation | *deferred (out of B2)* | COR-018 — post-as-org + per-human attribution. Not authored this slice. | — | — |
| 10 Participant persona binding **[Tier-2]** | **backend** | Provisioning-time half of COR-018's AC1 (see story 09's boundary note). Extends `login/05`'s bootstrap slice additively — a persona-reference field on the participant sub-request, plus a new secret-gated rebind endpoint for an already-provisioned account. Relocated in from `login/07` (#342) after `login` closed at six stories. | `src/Pulse.WebApi/Features/Ops/Bootstrap/` (edits: `BootstrapDtos.cs`, `BootstrapService.cs`, `BootstrapEndpoints.cs`; new: `OpsPersonaResolver.cs`, `ParticipantPersonaBindingService.cs`, `ParticipantPersonaBindingDtos.cs`) | `POST /api/ops/bind-participant-persona`; the extended `bootstrap-exercise` participant sub-request persona binding; `OpsPersonaResolver` (the ops-context isolation seam — see Reuse map) |
| 11 API session enforcement **[Tier-2, #359]** | backend | Closes the unbuilt half of COR-012: a composition-root default-deny gate (every endpoint requires a live session except the 5-item pre-auth allowlist), server-side `authorPersonaId`/`origin`/`actingHumanId` derivation on `POST /api/posts` (never client body), and the anonymous-401 regression suite. Touches `Program.cs` directly (not a normal parallel wave). | `src/Pulse.WebApi/Program.cs`; a new default-deny gate component (`Features/Identity/Sessions/`); `Features/Social/PostWriteEndpoints.cs` + `PostIngestService.cs`; a new general session-identity accessor; `Features/Identity/SharedAccess/ReadOnlySessionWriteFilter.cs` (doc/behavior fix) | The default-deny gate (consumed by every other endpoint from this point forward); the new session-identity accessor pattern |

## Reuse map
<Name B0's real seams — build on them, do not recreate.>

- **B0 backend seams (real C# in `src/Pulse.WebApi/`, merged):**
  - `Data/IExerciseContext.cs` — `CurrentExerciseId` (get-only, nullable; fail-closed null→`Guid.Empty`).
  - `Data/ExerciseContext.cs` — the **settable, Scoped `CurrentExerciseId`** — **the scope-resolution
    seam** stories 03 (session) and 05 (staff active-exercise) WRITE within the request scope
    (participant pre-auth host write is exercise-isolation/08).
  - `Data/Extensions/ExerciseScopingServiceCollectionExtensions.cs` — `AddExerciseScoping()` (wired in
    `Program.cs`).
  - `Data/PulseDbContext.cs` — the read-side global query filter + write-time `SaveChanges` scope guard.
    New scoped entities (`Account`, `SharedCredential`) EXTEND this via create-then-extend; do not stand
    up a second `DbContext`.
  - `Data/IExerciseScoped.cs` — the marker scoped entities implement. **`Account`/`SharedCredential`
    implement it; `StaffUser`/`StaffAssignment` deliberately do NOT** (cross-exercise by design,
    COR-005 — see the StaffAssignment note below).
  - `Data/Extensions/PersistenceServiceCollectionExtensions.cs` — `AddPulsePersistence()`.
  - `Features/{Social,Realtime,Telemetry}/*` — the endpoint pattern to follow: minimal-API endpoint
    extension classes (`FeedEndpoints`, `PostWriteEndpoints`) exposing `AddX()`/`MapX()`, `*Service`
    classes, DTOs, and the XC-004 telemetry emission pattern (`PostIngestService` emits one v0 envelope;
    `TelemetryController` is the durable sink). Route base **`/api`**.
  - `Program.cs` — the composition root (orchestrator-owned, serial). B2 stories export their own
    `AddX()`/`MapX()`/auth-scheme registration; the orchestrator wires the one-line calls + middleware
    ordering.
- **Frozen frontend seams (client contract — make real; single flip point each):**
  - `core/auth/sessionResolver.ts` — `resolveSession(): Promise<Session>` → `GET /session`; flip
    `USE_MOCK_SESSION` (story 03). Real `/api/session` MUST return the exact `Session` shape
    `{ exerciseId, accountId, role, personaId?, actingHumanId, isReadOnly, expiresAt }`.
  - `core/auth/session.tsx` — `SessionProvider`/`useSession()`; `core/auth/roles.ts` — `useRole()`.
  - `App.tsx` — mounts `SessionProvider` (the nav story `app-shell/01` routes on the live session).
- **XC-004 telemetry:** the locked v0 envelope (`src/frontend/src/core/telemetry/schema.ts`) + the
  server mirror (`Data/Entities/TelemetryEvent.cs`). Auth events emit against it: participant login →
  `actor.kind: 'participant'`; staff/lifecycle → `actor.kind: 'system'` + role + `actingHumanId`;
  read-only → `actor.kind: 'system'` + `actor.sessionId` (ephemeral, no named account). Channel `system`;
  known types `login`/`logout`, additive
  `session.refreshed`/`session.expired`/`exercise.switched`/`credential.rotated`/`credential.revoked`/
  `auth.lockout`. **Scenario time := the exercise's stored scenario time as a B2 placeholder** until the
  COR-050 backend clock (Phase B3) lands (a documented follow-up, mirroring B1's `ActingHumanId`
  placeholder).
- Cadence bulk-import UX (02) + `ExerciseRole` vocabulary (01) + COBRA theme (staff import panel 02).
- **Consumed by:** `app-shell/01` (live session/role + StaffAssignment), `exercise-isolation/04`
  (participant guard), `exercise-isolation/05` (switcher), E2 SOC-006 (account switcher), E7 (attribution).

### `OpsPersonaResolver` — the isolation seam for ops endpoints (story 10)

`Features/Ops/Bootstrap/OpsPersonaResolver.cs` is where the exercise-isolation rule for **ops-surface**
persona lookups lives, and any future ops endpoint that resolves a persona should call it rather than
reinvent the pattern. The reason it exists as its own class: ops endpoints (`bootstrap-exercise`,
`seed-engine-content`, `bind-participant-persona`) run with **no ambient exercise scope** — there is no
session/exercise-scope middleware in front of them, only the `X-Bootstrap-Secret` header gate — so the
injected `PulseDbContext` sits on the fail-closed `Guid.Empty` central filter. Every scoped read through
`OpsPersonaResolver` therefore uses `IgnoreQueryFilters()` **plus** an explicit `ExerciseId` predicate;
dropping either half either resolves nothing (filter left in place) or resolves across every exercise's
cast (predicate dropped) — COR-001 violated either way.

**Do not copy `EngineReviewService.ResolvePersonaHandlesAsync` for this purpose.** That resolver is
correct for its own caller because it runs *inside* an authenticated, session-scoped request where
`PulseDbContext`'s central filter is already correctly populated — it relies on that filter rather than
predicating explicitly. Reused from an ops context (no scope populated) it would resolve **nothing**, or,
if a scope happens to be stale/wrong, **the wrong exercise's persona** — exactly the bug this story exists
to prevent. `OpsPersonaResolver` and `EngineReviewService`'s resolver are not interchangeable; they solve
the same lookup under two different scope regimes.

### The `ExerciseContext.CurrentExerciseId` precedence model (the crux — one seam, three populators)
`ExerciseContext.CurrentExerciseId` is a single Scoped, settable value written by three populators, in
this precedence:
1. **Authenticated session (story 03 — incl. staff active-exercise selection, story 05):** highest.
   Runs in the auth/session layer, **after** the host middleware, so it overwrites the host's provisional
   write. Participant → the session's bound exercise; staff → the selected active exercise.
2. **Host resolution (exercise-isolation/08's `UseExerciseResolution()`):** scopes **anonymous / pre-auth**
   participant requests (the login page, the first `/exercise-context`). Runs early in the pipeline.
3. **Unset:** fail-closed floor (`null` → `Guid.Empty` → zero rows).

For a participant, the session's exercise **must equal** the host's resolved exercise; a mismatch fails
closed. `Program.cs` middleware order (orchestrator-owned): `UseExerciseResolution()` (08) → auth/session
(03). Endpoint ownership is clean: **`/session` is story 03's; `/exercise-context` is exercise-isolation/08's**
— the two frozen resolvers each have exactly one owning story.

### Why `StaffAssignment` is exempt from the isolation filter (and why that is safe)
`StaffAssignment` (and `StaffUser`) are **cross-exercise by design** (COR-005 — a staff human spans
exercises). They therefore do **not** implement `IExerciseScoped`, so the global query filter never
confines them to one exercise and the write-guard never demands an `ExerciseId`. Safe because: (a) they
are **staff-world-only** access records, never queried on a participant path (XC-002); (b) they carry
**no participant-visible content** — the isolation guarantee protects content, and `StaffAssignment` is an
access-control join (exercise id + role), not content; (c) a staff user's assignment read returns only
their own assignments; (d) content isolation still holds — the moment a staff user's active-exercise is
selected it populates `CurrentExerciseId`, and every `IExerciseScoped` **content** query is scoped from
then on. The only cross-exercise object in the model is this access record, by design.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Roles | frontend | `core/auth/roles.ts` (shipped seed) | exercise-isolation | 05 | 1 | M |
| 05 Provider + staff identity **[Tier-2]** | backend | `Features/Identity/` staff slice | `backend-host/02` (B0) | 01; **exercise-isolation/08** (same wave, other feature) | 1 | M |
| 03 Sessions **(hinge)** | fullstack | `Features/Identity/Sessions/` + `USE_MOCK_SESSION` flip | 08 (exercise scope + precedence), 05 (staff identity shape), `backend-host/02` | — | 2 | L |
| 02 Named accounts | fullstack | `Features/Identity/` account slice + `AccountImport.tsx` | 03, 08 | 06 | 3 | M |
| 06 Shared read-only **[Tier-2]** | backend | `Features/Identity/` shared-cred slice | 03, 08 | 02 | 3 | M |
| 04 Evaluator read-only | backend | authz policy | 01 | 07 | 3 | S |
| 07 Credential lifecycle **[Tier-2]** | backend | `Features/Identity/` shared-cred lifecycle slice | 06 | 04; `app-shell/01`; `exercise-isolation/04`+`05` | 4 | M |
| 08 Participant admin | *deferred* | — | — | — | — | — |
| 09 Org-account operation | *deferred* | — | — | — | — | — |
| 10 Participant persona binding **[Tier-2]** | backend | `Features/Ops/Bootstrap/*` (edits) + `OpsPersonaResolver.cs`, `ParticipantPersonaBindingService.cs`, `ParticipantPersonaBindingDtos.cs` (new) | `login/05` (the bootstrap slice it extends, merged); `engine-content-seed` (the persona cast) | — | 5 (post-B2, relocated in Complete from `login/07`, #342) | M |
| 11 API session enforcement **[Tier-2, #359]** | backend | `Program.cs` (direct edit — see note below); new default-deny gate; `Features/Social/PostWriteEndpoints.cs`+`PostIngestService.cs`; new session-identity accessor; `ReadOnlySessionWriteFilter.cs` | 03, 05, 06, `exercise-isolation/08`, `social-api` (all merged) | — (serial; see the story's own 3-sub-wave split) | 6 | L |

File-disjointness within a wave: each B2 backend story owns its own slice folder under
`Features/Identity/*` (distinct files) and its own `PulseDbContext` `OnModelCreating`/migration addition;
`Program.cs` is orchestrator-owned (below), so no two stories collide there.

**Story 10** sits outside the B2 wave numbering (it was built and shipped later, under `login`, then
relocated here) — its own files live under `Features/Ops/Bootstrap/*`, disjoint from every
`Features/Identity/*` slice above, so it never collided with B2's waves in practice.

**Story 11 is the one exception to the orchestrator-owned rule:** it edits `Program.cs` itself (the
default-deny wrapper) rather than exporting a single `Add*()`/`Map*()` line for the orchestrator to wire,
so it cannot fan out in parallel with any other `Program.cs`-touching change and is scheduled after every
prior wave has merged. Its own file documents a further 3-sub-wave split (gate+allowlist → `POST /api/posts`
attribution → regression suite) since it is too broad for one commit.

### Integration seams (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Each story exports its own `Add*()`/`Map*()`/auth-scheme registration; the orchestrator wires the one-line calls **and the middleware ordering** serially between waves. Critical ordering: `app.UseExerciseResolution()` (exercise-isolation/08) → the **auth/session** middleware (story 03) → `MapControllers()`/endpoint maps — so the session's scope write takes precedence over the host's (the precedence model above). |
| Frontend mock→live flip | `core/auth/sessionResolver.ts` (`USE_MOCK_SESSION`) | Story 03 flips this single point live once `/api/session` is Gate-2 clean; a serial, orchestrator-owned integration edit. `session.tsx`/`useSession()` consumers need no change (the `Session` shape is unchanged). |
