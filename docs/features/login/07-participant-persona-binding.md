# Story: Participant persona binding — provision a participant account with a posting persona

**Feature:** Login  ·  **Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-011, COR-018, SOC-001, SOC-003 (COR-001, COR-015)  ·  **Design decisions:** none  ·  **Issue:** #342
**Stack:** backend  ·  **Review:** Tier-2 (a new ops surface, auth-adjacent, behind the existing bootstrap
secret — same review class as story 05)

## Context
A participant can now SEE engine-approved and manual-persona posts in the feed (PR #338), but a participant cannot CREATE a post, because their account has no bound persona. `Account.PersonaId` is nullable and nothing in the ops/bootstrap surface ever sets it: the `bootstrap-exercise` participant sub-request (`BootstrapParticipantAccountRequest`) has no `personaId` field, and `BootstrapService` never assigns one. So `ParticipantLoginService` issues a session with `personaId` null, the frontend `canPost` is false, and the composer stays hidden ("Posting isn't available on this account"). This is the remaining half of the participant compose flow that PR #338 wired end to end but which is inert without a bound persona; today the only way to bind one is a manual `UPDATE Accounts SET PersonaId = ...`.

## Acceptance Criteria

**Both AC1 and AC2 are in scope — the user has decided to build both, not choose one.** AC1 covers a
freshly-provisioned environment (the participant account is created in the same bootstrap call as its
persona binding); AC2 covers an **already-provisioned** account — which is UAT's actual situation today
(`participant1` already exists there) — so AC2 is what actually unblocks UAT.

- [ ] **AC1.** The `bootstrap-exercise` participant-account sub-request (`BootstrapParticipantAccountRequest`)
      accepts an optional persona reference — a **handle** (a persona's `Handle`, e.g. `"river_ortiz"`) or an
      id — and, when the participant account is created on that call, persists the resolved persona onto
      `Account.PersonaId`. The reference is validated to resolve to an existing `Persona` **in the same
      bootstrapped exercise** (COR-001); an unknown or cross-exercise reference fails the request (400),
      never silently ignored or bound to the wrong exercise's persona.
- [ ] **AC2.** A new guarded endpoint, `POST /api/ops/bind-participant-persona`, binds (or rebinds) a persona
      to an **already-provisioned** participant account by `username`, for exactly the case AC1 cannot cover
      (the account already exists). Gated by the same `BootstrapSecretGate` / `X-Bootstrap-Secret` header and
      the same fail-closed-to-404 posture as `bootstrap-exercise` and `seed-engine-content` — a missing/wrong
      secret returns `404`, never confirming its own existence. Accepts the same handle-or-id persona
      reference as AC1, resolved and validated the same way (existing persona, same exercise only).
- [ ] **Given** a participant whose account has a bound persona, **when** they sign in, **then**
      `Session.personaId` is populated, the participant composer is available, and a post they publish
      persists via `POST /api/posts` (origin `participant`) and reaches other participants (PR #338).
- [ ] **Given** a participant account with no bound persona, **then** the composer remains absent (COR-015
      observer style), never a broken or enabled control.
- [ ] **Given** a handle or id that does not resolve to a persona in the target exercise (unknown, or a real
      persona but from a *different* exercise), **when** either AC1's sub-request or AC2's endpoint is
      called, **then** the binding is rejected (400) and no `Account.PersonaId` is written — fail closed,
      never a cross-exercise bind (COR-001).
- [ ] The binding is auditable (XC-004) and never lets a participant post as a persona from another exercise
      (COR-001).

## Out of Scope
- Letting a participant choose or switch personas at runtime (this is provisioning-time binding).
- Controller post-as-persona (persona-operation, already shipped).
- Any change to `POST /api/posts` itself (the write path already accepts an `authorPersonaId`; this story is about provisioning the account to have one).

## Technical Notes
World: **backend, ops-only** — same posture as story 05 (`src/Pulse.WebApi/Features/Ops/Bootstrap/`; no
participant/staff session gate, the secret header is the only gate). `Account.PersonaId` (nullable) and
`ParticipantLoginService` already carry the persona through to `Session.personaId`; the gap is purely
provisioning. Extends story 05's existing bootstrap slice in place — `BootstrapDtos.cs` (the new
persona-reference field on `BootstrapParticipantAccountRequest`, and the new `POST
/api/ops/bind-participant-persona` request/response DTOs), `BootstrapService.cs` (persona resolution +
the new bind/rebind method), `BootstrapEndpoints.cs` (the new endpoint mapping) — this is an **edit to
the same slice**, not a new one, sharing `BootstrapSecretGate` by reference, never forking it.

**Bind by persona HANDLE, not by GUID (record this decision here so it is not re-litigated later).**
Both AC1 and AC2 accept a persona **handle** as the primary reference (an id is also accepted, for a
caller that happens to have one), because a GUID is not actually obtainable through any existing HTTP
surface an operator has access to:
- `POST /api/ops/seed-engine-content` (`EngineContentSeedResponseDto`) returns only
  `personasCreated`/`personasReused` **counts** — never the seeded personas' ids (see
  `src/Pulse.WebApi/Features/Ops/EngineContentSeed/EngineContentSeedDtos.cs`).
- `GET /api/personas` (`src/Pulse.WebApi/Features/Social/PersonaEndpoints.cs`) requires an authenticated
  session — which, for a fresh/UAT environment, is exactly the chicken-and-egg this whole ops surface
  exists to break.

So an operator following the runbook has no way to *obtain* a `personaId` short of a manual SQL query —
the exact thing this story exists to eliminate. A handle (e.g. `"river_ortiz"`) is discoverable directly
from the seeder's known cast (`PersonaCastSeeder`); a GUID is not discoverable at all without that SQL
escape hatch. Resolve the handle case-insensitively (mirrors `Account.Username`'s CI collation policy)
against `Persona.Handle` (`Data/Entities/Persona.cs`), scoped with an explicit `ExerciseId` predicate
(the captured request scope is empty here, same reasoning `BootstrapService` already documents for its
other idempotency reads) — **never** across exercises. Fail closed (400) on an unknown handle/id or one
that resolves to a persona in a *different* exercise (COR-001).

## Dependencies
Login story 05 (the bootstrap seam, #308) that this extends — same slice, additive edit, not a fork;
`engine-content-seed` (the persona cast, `PersonaCastSeeder`, a participant would be bound to — and the
reason AC1/AC2 resolve by handle rather than id, see Technical Notes); PR #338 (the participant compose +
feed write path this makes reachable).

## Tests
- Backend: AC1 — bootstrapping a participant account with a persona **handle** binds it onto
  `Account.PersonaId`; login then returns that `personaId`.
- Backend: AC2 — `POST /api/ops/bind-participant-persona` binds/rebinds a persona (by handle) onto an
  **already-existing** account by username; a missing/wrong secret returns 404; a missing binding yields
  a null-persona session.
- Backend: **cross-exercise rejection** — a handle or id that resolves to a real `Persona` belonging to a
  *different* exercise is rejected (400) by both AC1's sub-request and AC2's endpoint, and
  `Account.PersonaId` is left unchanged (never bound to the wrong exercise's persona, COR-001).
- Backend: an unknown handle/id (no persona anywhere matches) is rejected (400) the same way.
- Backend (composition-root wiring guard): the endpoint is actually reachable through the real,
  fully-wired `app` — not only a self-mapped `TestServer` built by this story's own test project (see
  `implementation.md`'s integration-seam note on #308/#317).
- Frontend: with a bound persona the composer is available and publishes live; without one it stays absent.

### As built (backend)
All under `src/Pulse.WebApi.Tests/Features/Ops/Bootstrap/`. DB-backed tests are `[RequiresDockerFact]`
(real SQL Server via Testcontainers, or a local SQL Server via `PULSE_TEST_SQL_CONNECTION`).

| Test | AC |
|------|----|
| `BootstrapPersonaBindingTests.Bootstrap_WithPersonaHandle_BindsPersonaToTheAccount` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_WithPersonaId_BindsPersonaToTheAccount` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_PersonaHandle_MatchesCaseInsensitivelyAndIgnoresLeadingAt` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_ReRun_FillsAnAbsentBinding_ButNeverClobbersADifferentOne` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_FreshExerciseWithPersonaHandle_IsRejected_BecauseTheCastIsNotSeededYet` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_PersonaIdAndHandleDisagree_IsRejected` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_BoundAccount_LoginPopulatesSessionPersonaId` | AC3 |
| `BootstrapPersonaBindingTests.Bootstrap_AccountWithNoBinding_LoginYieldsNullPersonaSession` | AC4 |
| `BootstrapPersonaBindingTests.Bootstrap_CrossExercisePersonaHandle_IsRejected_AndWritesNothing` | AC1, AC5 |
| `BootstrapPersonaBindingTests.Bootstrap_CrossExercisePersonaId_IsRejected_AndWritesNothing` | AC1, AC5 |
| `BootstrapPersonaBindingTests.Bootstrap_UnknownPersonaHandle_IsRejected_AndWritesNothing` | AC1 |
| `BootstrapPersonaBindingTests.Bootstrap_WithPersonaBinding_RecordsItOnTheSingleBootstrappedTelemetryEvent` | AC5 |
| `ParticipantPersonaBindingServiceTests.Bind_ByHandle_BindsThePersona_AndTheNextLoginCarriesIt` | AC2, AC3 |
| `ParticipantPersonaBindingServiceTests.Bind_ById_BindsThePersona` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_ByHandle_MatchesCaseInsensitivelyAndIgnoresLeadingAt` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_SamePersonaTwice_IsAnIdempotentNoOpSuccess` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_ToADifferentPersona_RebindsAndReportsThePrevious` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_UnknownUsername_FailsClosed_WithoutCreatingAnAccount` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_UnknownHostname_FailsClosed_WithoutCreatingAnExercise` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_UnknownPersonaHandle_FailsClosed` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_NeitherHandleNorId_IsInvalid` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_PersonaIdAndHandleDisagree_IsInvalid` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_WrongSecret_IsRejected_AndWritesNothing` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_UnconfiguredSecret_IsRejected_RegardlessOfPresentedValue` | AC2 |
| `ParticipantPersonaBindingServiceTests.Bind_CrossExercisePersonaHandle_FailsClosed_AndLeavesTheAccountUnbound` | AC5 |
| `ParticipantPersonaBindingServiceTests.Bind_CrossExercisePersonaId_FailsClosed_AndLeavesTheAccountUnbound` | AC5 |
| `ParticipantPersonaBindingServiceTests.Bind_CrossExerciseUsername_FailsClosed` | AC5 |
| `ParticipantPersonaBindingServiceTests.Bind_Success_EmitsExactlyOnePersonaBoundTelemetryEvent` | AC5 |
| `ParticipantPersonaBindingServiceTests.Bind_IdempotentNoOp_IsStillAudited` | AC5 |
| `ParticipantPersonaBindingEndpointHttpTests.*` (7 plain `[Fact]`, no Docker — 404/400 fail-closed mapping + the per-IP 429) | AC2 |
| `CompositionRootWiringTests.ProgramCs_MapsTheBindParticipantPersonaEndpointExactlyOnce` | AC2 |

Frontend: no change was required — `useComposePost.ts` already derives `canPost` from `session.personaId`
and `Composer.tsx` already renders the absent case (AC4), so no frontend test was added.
