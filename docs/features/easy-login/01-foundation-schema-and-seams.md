# Story: Foundation: schema, shared kernel, frozen contract

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-012, COR-018 (enabling), XC-001, XC-004  ·  **Design decisions:** none (EL-1, EL-5, EL-6, EL-9, EL-13, EL-17 in `implementation.md`)  ·  **Issue:** —
**Stack:** backend  ·  **Review:** Tier-2 (a migration, two new isolation-bearing entities, and the frozen contract)  ·  **Priority:** Must  ·  **Wave:** 0  ·  **Effort:** M

## Context

Five backend stories (roster, links, cards, day word, sessions) run in parallel on Wednesday. This story is
what lets them do that without touching a shared file. It lands, once and first: the **one migration**, the
**frozen DTOs**, the **one new unscoped `Exercises` read**, and the small shared kernel (token generation,
URL building, time-of-day maths, telemetry builders, the staff role gate). The repo pins several things that
would otherwise conflict between four builders (the migration snapshot, the `ResolvedScope` exemption count
in `OrganizationScopeSweepTests`); EL-17 explains why they are concentrated here.

World: platform foundation (no UI). Nothing in this story is reachable over HTTP; it only registers services.

## Acceptance Criteria

### Schema (one migration)
- [ ] **Given** the migration `EasyLoginSchema` is applied on top of the latest one, **then** the tables
      `ParticipantLinks` and `ExerciseDayWords` exist and `Accounts` gains `Agency` (nvarchar 128, null),
      `JobRole` (128, null), `Email` (254, null), `DisabledAt` (datetimeoffset, null) and
      `PersonaAutoCreated` (bit, default 0). Every new column is nullable or defaulted, so **existing accounts
      still sign in** with their password and no existing row changes behaviour. The model snapshot is
      updated, and no other story in this feature adds a migration (EL-17).
- [ ] `ParticipantLink` has `Id`, `ExerciseId`, `AccountId`, `TokenHash` (nvarchar 64, unique), `ProtectedToken`
      (nvarchar 512, null), `Generation` (int), `IssuedAt`, `IssuedByStaffUserId` (null: provisioning),
      `RevokedAt` (null), `RevokedByStaffUserId` (null), `LastUsedAt` (null), `UseCount` (int), with a unique
      index on `(ExerciseId, AccountId)`. `ExerciseDayWord` has `Id`, `ExerciseId`, `ForDate` (`date`),
      `WordHash`, `SetAt`, `SetByStaffUserId`, `ReplacedCount` (int), with a unique index on
      `(ExerciseId, ForDate)`. The idempotent-migration-script and round-trip migration guards stay green.

### Isolation
- [ ] **Isolation (XC-001/COR-001):** both entities implement `IExerciseScoped` with a non-null `ExerciseId`
      and are covered by the central read filter and the write guard with no per-entity code. A row seeded in
      exercise B is invisible under exercise A's scope; saving one with no resolved scope throws. The standing
      sweeps (`QueryFilterModelTests`, `OrganizationScopeSweepTests`, `UnscopedIdentityEntityTests`) stay
      green, and a case modelled on `AccountAndSharedCredentialIsolationTests` is added for the two entities.

### Frozen contract
- [ ] `Features/Identity/EasyLogin/EasyLoginDtos.cs` holds one C# DTO per type in the
      [frozen contract](implementation.md#frozen-wire-contract), each property with an explicit
      `[JsonPropertyName]` (camelCase) and optional members omitted when null (`WhenWritingNull`). A contract
      test serialises a populated instance of each and asserts the JSON keys and shapes **field for field**
      against the TypeScript in `implementation.md` (transcribed into the test as expected JSON).

### Shared kernel (each piece unit-tested)
- [ ] **Tokens:** `ParticipantLinkTokens.Generate()` returns 16 random bytes as base64url (22 characters, no
      padding); `Hash(raw)` is `SessionTokens.Hash`. Two calls never return the same value. `IParticipantLinkTokenProtector`
      (ASP.NET Data Protection, a fixed purpose string) round-trips a token, and returns **null, never throws**,
      for tampered text, text protected under another purpose, or a key ring that no longer contains the key.
- [ ] **URLs and days:** `JoinUrlBuilder.Build(token)` returns `{Authentication:FrontendBaseUrl}/join/{token}`
      (single slash join, `http`/`https` only) and **null** when the base is unset or not an absolute http(s) URL.
      `ExerciseDay.Today(tz, nowUtc, rolloverHour)` and `ExerciseDay.EndOfDayUtc(...)` are correct across a DST
      change in `America/New_York`, for a zone with a half-hour offset, with `rolloverHour` 0 and 3, and when a
      local midnight does not exist (the next valid instant is used); an unknown or blank zone falls back to UTC.
- [ ] **Exercise facts and telemetry:** `ExerciseFactsReader.GetAsync(exerciseId)` returns
      `{ Name, TimeZone, Status, OrganizationId, StoredScenarioTime }` through the **single** new
      `// org-scope-exempt(ResolvedScope)` read, and `OrganizationScopeSweepTests` pins `ResolvedScope` up by
      exactly one. `EasyLoginTelemetry` builds each event in the table in `implementation.md` and every built
      event **passes `TelemetryEnvelopeRules`**: a participant success has a `participantId`, an identity-less
      failure is `system`, and no payload or target can carry a token, word, URL or email (asserted).
- [ ] **Sessions and gates:** `ParticipantSessionRequests.For(account, exerciseId)` builds the same
      `SessionIssueRequest` `ParticipantLoginService` builds today (kind `participant`, `PersonaId`, acting human
      defaulting to the account id, not read-only). `RosterStaffRoleFilter` answers 401 with no staff session or
      no scope, 403 for an assigned **evaluator** or an unassigned staff user, and passes an assigned
      **controller** or **planner**; the exercise always comes from `IExerciseContext`, never the request.
- [ ] `IParticipantLinkIssuer` (`EnsureActiveAsync(account, issuedByStaffUserId, now)`) is registered with a
      fail-closed `NullParticipantLinkIssuer` default that story 03 replaces. `RosterLinkDtoFactory` turns a
      `ParticipantLink?` into a `RosterLinkDto` (status, `joinUrl` only when active and recoverable,
      `needsReissue` when active but not decryptable). `AddEasyLoginFoundation()` registers all of it (including `TimeProvider.System` with `TryAddSingleton`, which
      stories 05 and 06 inject so day-boundary tests need no sleeping) and binds
      `EasyLoginOptions` from `Authentication:EasyLogin` with the defaults in `implementation.md`. The `QRCoder`
      package reference is added to `Pulse.WebApi.csproj` and the solution restores and builds warning-free.

## Out of Scope

Any endpoint, any route mapping, any `Program.cs` edit (orchestrator seam). The behaviour of the roster,
links, cards, word and sessions (stories 02 to 06). The Data Protection key-ring storage choice beyond the
App Service default (a documented limitation, not a build item). Any change to `PreAuthAllowlist` or its tests.

## Technical Notes

Backend. New folder `src/Pulse.WebApi/Features/Identity/EasyLogin/`; entities under `Data/Entities/`;
`PulseDbContext` gets two `DbSet`s and model config only (the central filter loop and write guard are
untouched). Create the migration with the existing design-time factory and check the generated SQL for the
`(ExerciseId, AccountId)` and `(ExerciseId, ForDate)` indexes. Use `DateOnly` for `ForDate` (EF Core 10 maps it
to `date`). `ExerciseFactsReader` is the only code that reads `_dbContext.Exercises` for this feature; give it
the same marker wording as `InjectQueueService.ReadExerciseFactsAsync`. Telemetry builders follow
`SharedCredentialLifecycleService.BuildLifecycleTelemetry`. See `implementation.md` (story 01, reuse map,
gotchas 1 to 8).

## Dependencies

None (builds on `main`: `backend-host`, `identity-auth-roles/02, 03, 05`, the sessions and lifecycle code).
Blocks stories 02, 03, 04, 05, 06 and 13.

## Tests

`Pulse.WebApi.Tests/Features/Identity/EasyLogin/`: `EasyLoginDtoContractTests`, `ParticipantLinkTokensTests`,
`ParticipantLinkTokenProtectorTests`, `JoinUrlBuilderTests`, `ExerciseDayTests`, `ExerciseFactsReaderTests`,
`EasyLoginTelemetryTests`, `ParticipantSessionRequestsTests`, `RosterStaffRoleFilterTests`,
`RosterLinkDtoFactoryTests`, `EasyLoginRegistrationTests`. `Pulse.WebApi.Tests/Data/EasyLoginIsolationTests`
(`[RequiresDockerFact]`, Testcontainers like its siblings) and `EasyLoginMigrationTests` (round-trip and
idempotent script). `OrganizationScopeSweepTests` count bump (+1).
