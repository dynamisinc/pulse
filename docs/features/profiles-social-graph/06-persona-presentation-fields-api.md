# Story: Persona presentation fields (backend)

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-020, COR-021, SOC-052, SOC-054, XC-005  ·  **Design decisions:** none  ·  **Issue:** _TBD — mirrored after authoring_
**Stack:** backend

## Context
The B0/B1 `Persona` entity (`src/Pulse.WebApi/Data/Entities/Persona.cs`) persists only
`Id`/`ExerciseId`/`DisplayName`/`Handle`/`PersonaTemplateId`/`Kind`/`Verified`. `PersonaResponseDto
.FromPersona` (`src/Pulse.WebApi/Features/Social/PersonaEndpoints.cs:174`) therefore returns
**documented B1 stand-ins** for five fields the frozen client contract (`features/personas/
types.ts:84-101`) declares: `personaType` = `"citizen"`, `avatarColor`/`initials` deterministically
derived from handle/name (not authored), `audienceBand` = `"micro"`, `followerCount` = `0`,
`joinedAt` = a fixed `"2026-01-01T00:00:00Z"` — and `bio` is omitted entirely, never emitted even
as `null`.

**Consequence.** In UAT (mock off) every profile renders **0 Followers**, no bio, an identical join
date across the whole cast, and every persona presents as the same `citizen` archetype regardless of
what it actually is. `01-profile-page` and `03-verification-and-impersonation` are marked Complete,
but that status is only true against the frontend's `SEEDED_PERSONAS`/`seedCast()` mock fixture —
see `feature.md`'s note on this. `05-audience-magnitude` (the follower-count formula, magnitude +
edges) is **impossible** to build truthfully until a real `audienceBand`/magnitude exists on the
live entity; this story is what makes it possible (edges themselves are story 07).

This is the read-model half of COR-020/021: COR-020 names `audience magnitude band` and `bio` as
persisted template fields planners author; COR-021 names `varied follower counts` and `join dates
predating the exercise` as the believable derived state seeding must produce. Neither exists on the
live entity today. `persona-management`'s own template-authoring UI (COR-020's planner-facing half)
is a separate, later feature (see Out of Scope) — this story only makes the **already-seeded engine
cast** (`PersonaCastSeeder`) and the **read projection** (`PersonaResponseDto`) tell the truth.

## Acceptance Criteria
- [ ] **Persisted fields.** The `Persona` entity gains `Bio` (nullable `string`), `PersonaType`
      (`string`, mirrors the frontend `PersonaType` union), `AudienceBand` (`string`, mirrors the
      frontend `AudienceBand` union: `nano`/`micro`/`mid`/`large`/`mega`), `AudienceMagnitude`
      (`int` — the SOC-054 magnitude derived from the band at seed time, **distinct from the real
      follow graph**, which story 07 adds separately), and `JoinedAt` (`DateTimeOffset` or
      equivalent scenario-instant representation). An EF Core migration adds all five columns.
- [ ] **Real projection, unchanged contract.** `PersonaResponseDto.FromPersona` projects the real
      persisted `Bio`/`PersonaType`/`AudienceBand`/`AudienceMagnitude`/`JoinedAt` values — the five
      hardcoded B1 stand-ins (`"citizen"`, `"micro"`, `0`, the fixed `2026-01-01` instant) and the
      `bio`-omission are removed from the DTO. The frozen client contract shape
      (`features/personas/types.ts:84-101`) is **unchanged** — field names, types, and
      required/optional status stay exactly as shipped — so only the *values* become real and no
      frontend code change is required to consume this story.
- [ ] **Seeder populates real state.** `PersonaCastSeeder` (`Features/Ops/EngineContentSeed/
      PersonaCastSeeder.cs`) populates all five new fields for every catalog persona.
      `AudienceMagnitude` is derived from `AudienceBand` the same way the frontend's mock derivation
      does — read `src/frontend/src/features/personas/seedCast.ts`'s `BAND_BASE` table and
      `deriveFollowerCount` (band floor + a deterministic, non-random per-handle jitter) and mirror
      the bands/derivation so a live-seeded exercise and the frontend mock agree on believable
      numbers for the same handle. `JoinedAt` is a deterministic **pre-exercise scenario instant**
      derived the same way `seedCast.ts`'s `deriveJoinedAt` does (a fixed epoch constant minus a
      deterministic per-handle offset) — **never** a read of the server's wall clock (COR-053,
      COR-023) — with bad-actor/impersonator personas joining **recently** (3-6 days before the
      epoch; the lookalike "joined this week" tell) and every other persona joining well before the
      exercise (weeks to ~2 years).
- [ ] **Impersonation pair + live-cast parity.** The seeded catalog gains the SOC-052 impersonation
      pair currently present only in the frontend mock (`personaTemplates.ts`) and absent from the
      live `PersonaCastSeeder.Catalog`: `@FairhavenWaterUpd` (org, `Verified = false`, display name
      `"Fairhaven Water Update"` — a near-identical lockup of the verified `"Fairhaven Water
      Utility"` / `@FairhavenWater`, recent `JoinedAt`) alongside the existing verified
      `@FairhavenWater`. Also add `@TheScoopHQ` (org, unverified, `influencer` type) and
      `@dreyes_fh` (human, unverified, `citizen` type) so the live nine-persona cast matches the
      frontend's nine-template cast handle-for-handle. Matching the platform's own rule (D1-008),
      the seeder never marks or flags the lookalike in any field — the absent `Verified` flag is the
      only signal, exactly as every other unverified persona is represented.
- [ ] **No new leak (XC-002).** Exercise scope (COR-001) is unchanged — every new field is exposed
      only through the existing exercise-scoped `GET /api/personas` read, with no new provenance/
      operator/session-attribution field added to the DTO.
- [ ] **Idempotent seeding.** Re-running the seeder for an already-seeded exercise does not duplicate
      rows or overwrite an existing row's fields (mirrors the seeder's existing `(ExerciseId,
      Handle)`-keyed idempotency, `IX_Personas_ExerciseId_Handle`) — the three new catalog handles
      are added on the first re-seed of an exercise that predates them, without disturbing the six
      that already exist.

## Out of Scope
The real follow graph and the edges component of the displayed follower count (story 07). Planner-
facing template authoring/CRUD — creating, editing, cloning, or archiving `PersonaTemplate` rows via
a staff UI (COR-020's authoring half, `persona-management/01-05`, a separate feature not touched
here — this story only extends the **engine's own** fixed-cast seeder, `PersonaCastSeeder`, and the
entity/DTO it writes/reads). Mid-exercise persona creation (COR-022, `persona-operation/05`).
Backdated pre-exercise **post** history (COR-023, `persona-management/04`) — this story only
backdates the persona's own `JoinedAt`. Avatar upload (COR-024).

## Technical Notes
Backend/service work. Owns `Pulse.WebApi/Data/Entities/Persona.cs` (five new properties + the
migration), `Pulse.WebApi/Features/Social/PersonaEndpoints.cs` (`PersonaResponseDto.FromPersona` —
remove the stand-in constants and the `AvatarColorForHandle`/`InitialsForDisplayName` derivation
stays as-is since those two remain genuinely derived, not persisted, per the frozen contract),
`Pulse.WebApi/Features/Ops/EngineContentSeed/PersonaCastSeeder.cs` (extend `PersonaSeedSpec` and
`Catalog` with the new fields + the three new entries, and the magnitude/join-date derivation
helpers mirroring `seedCast.ts`). Every new stored free-text field (`Bio`) runs through the existing
`PostSanitizer.Sanitize` funnel the seeder already uses for `DisplayName`/`Handle`/`VoiceNotes`
(NFR-004), even though these are developer-authored constants today — consistent with the seeder's
existing posture on that point.

`AudienceMagnitude` vs. the eventual displayed follower **count**: this story only adds the
magnitude (the SOC-054 band-derived number a persona has independent of any real follow edge).
`05-audience-magnitude`'s formula (`count = magnitude + real edges`) is a **read-time** composition
over this field and story 07's edge table — it is not stored as a combined number here, and this
story does not implement that formula.

Cross-reference `implementation.md`'s reuse map + Wave Plan (Wave 0, serial with story 07 — both
touch `Data/Migrations/**` and `PulseDbContextModelSnapshot.cs`).

## Dependencies
`backend-host/02` (persistence/EF Core, `PulseDbContext`); `social-api/04` (the `GET /api/personas`
read path this projects through); `engine-content-seed/01` (`PersonaCastSeeder`, the seam this story
extends). None on story 07 (file-disjoint at the code level; only the migration-authoring order is
serial — see `implementation.md`).

## Tests
xUnit, `src/Pulse.WebApi.Tests/Features/Social/` and `.../Features/Ops/EngineContentSeed/`. Tests marked
**[docker]** are `[RequiresDockerFact]` (real SQL Server: Testcontainers in CI, or `PULSE_TEST_SQL_CONNECTION`
locally); the rest are model-only `[Fact]`/`[Theory]` and run everywhere.

**Persisted fields (AC1)**
- `PersonaEndpointsTests.Persona_MigrationRoundTrip_PersistsThePresentationFields_AndDefaultsSafely` [docker]
  — all five columns round-trip through a separate read context, and a row written without them lands on the
  documented contract-valid defaults (never `""`/`0001-01-01`).

**Real projection, unchanged contract (AC2)**
- `PersonaResponseDtoTests.FromPersona_ProjectsThePersistedPresentationValues_NotTheB1StandIns`
- `PersonaResponseDtoTests.FromPersona_KeepsAvatarColorAndInitials_DerivedAndStable`
- `PersonaResponseDtoTests.FromPersona_NullBio_OmitsTheKeyEntirely_RatherThanEmittingNull`
- `PersonaEndpointsTests.Response_ProjectsThePersistedPresentationFields_NotTheB1StandIns` [docker] — over
  HTTP, incl. the exact wire field-set (frozen contract + the optional `bio`, nothing more).

**Seeder populates real state (AC3)**
- `PersonaCastSeederTests.SeedAsync_PopulatesEveryPresentationField_ForEveryPersona` [docker]
- `PersonaCastDerivationTests.DeriveAudienceMagnitude_MatchesTheFrontendMock_ForTheSameHandleAndBand`
  (per-handle parity with `seedCast.ts`), `..._StaysWithinTheBandsFloorPlusForty` (the `BAND_BASE` band
  ranges), `..._IsDeterministic_AndBandOrdered`, `..._UnknownBand_Throws_RatherThanInventingANumber`
- `PersonaCastDerivationTests.DeriveJoinedAt_MatchesTheFrontendMock_AndAlwaysPredatesTheEpoch`,
  `..._BadActor_JoinsWithinAWeekOfTheEpoch_EstablishedPersonasJoinMuchEarlier`,
  `PersonaCastDerivationTests.SeedEpoch_IsTheFixedPreExerciseScenarioConstant_NeverTheWallClock`
- `PersonaCastSeederTests.SeedAsync_StoredFreeText_PassesThroughTheSanitizationFunnel` [docker] (now
  covers `Bio`, NFR-004)

**Impersonation pair + live-cast parity (AC4)**
- `PersonaCastSeederTests.SeedAsync_FreshExercise_CreatesExactlyNinePersonas_WithTheExactHandlesKindVerified`
  [docker]
- `PersonaCastSeederTests.SeedAsync_SeedsTheImpersonationPair_UnverifiedLookalike_WithNoFlagOfAnyKind`
  [docker] — `Verified = false`, no flag field of any kind, recent join date
- `PersonaResponseDtoTests.FromPersona_NeverFlagsAnUnverifiedLookalike_TheAbsentSealIsTheOnlySignal`

**No new leak (AC5)**
- `PersonaEndpointsTests.WiderProjection_StillLeaksNothingAcrossExercises_ScopeA_NeverSeesBsPresentationFields`
  [docker] — extends the standing isolation suite (`exercise-isolation/07`)
- `PersonaEndpointsTests.Response_ContainsOnlyShippedPersonaFields_NoProvenanceOrOperatorLeak` [docker]
  (existing, still green), `PersonaResponseDtoTests.FromPersona_CarriesNoProvenanceOrOperatorField_XC002`

**Idempotent seeding (AC6)**
- `PersonaCastSeederTests.SeedAsync_RunAgain_CreatesNoDuplicates_AndReturnsTheSameIds` [docker]
- `PersonaCastSeederTests.SeedAsync_AgainstAnExercisePredatingTheNewHandles_AddsExactlyThoseThree_AndDisturbsNothing`
  [docker]
- `EngineContentSeedServiceTests.Seed_ResolvesExistingExercise_SeedsNinePersonas_AndRegistersTheLoop` /
  `EngineContentSeedServiceTests.Seed_RunTwice_ReusesPersonas_AndReplacesRegistration_NeverDuplicates`
  [docker] (updated 6 → 9)
