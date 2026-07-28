# Story: Persona presentation fields (backend)

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-020, COR-021, SOC-052, SOC-054, XC-005  ·  **Design decisions:** none  ·  **Issue:** #369
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
> **Gate-1 amendments (approved by the story owner, folded in the second commit).** Three ACs below carry
> amendments recorded inline: **AC2** now splits the projection per world (`personaType` is STAFF-ONLY —
> emitting the archetype to a participant would be a machine-readable flag on the SOC-052 lookalike, D1-008);
> **AC4** adds the `Castable` engine-casting gate (the impersonator/low-credibility rows exist, but the engine
> cannot voice them until a scenario opts in); **AC6** adds a bounded, sentinel-only backfill exception to
> "never overwrite".

- [x] **Persisted fields.** The `Persona` entity gains `Bio` (nullable `string`), `PersonaType`
      (`string`, mirrors the frontend `PersonaType` union), `AudienceBand` (`string`, mirrors the
      frontend `AudienceBand` union: `nano`/`micro`/`mid`/`large`/`mega`), `AudienceMagnitude`
      (`int` — the SOC-054 magnitude derived from the band at seed time, **distinct from the real
      follow graph**, which story 07 adds separately), and `JoinedAt` (`DateTimeOffset` or
      equivalent scenario-instant representation). An EF Core migration adds all five columns.
- [x] **Real projection, unchanged contract.** `PersonaResponseDto.FromPersona` projects the real
      persisted `Bio`/`AudienceBand`/`AudienceMagnitude`/`JoinedAt` values — the hardcoded B1
      stand-ins (`"citizen"`, `"micro"`, `0`, the fixed `2026-01-01` instant) and the `bio`-omission
      are removed from the DTO. No frontend code change is required to consume this story.
      **AMENDED (Gate-1 WR-001) — the projection is now per-world.** `personaType` is **staff-only**:
      the archetype labels exactly one seeded account `bad-actor`, so emitting it on the endpoint the
      participant feed calls would hand a client a machine-readable way to flag the SOC-052 lookalike
      without the verified seal — exactly what D1-008 forbids. `GET /api/personas` therefore branches
      on the caller's world, the same way `ParticipantPostDto`/`StaffPostDto` already split post
      provenance (XC-002): a caller with a live `staff`-kind session (resolved through the standing
      `ICurrentStaffSessionAccessor` seam) receives `StaffPersonaResponseDto` **with** `personaType`;
      every other caller — participant, read-only, anonymous, expired token — receives
      `PersonaResponseDto`, which **structurally omits** it. The branch fails closed to the narrow
      shape. `avatarColor`/`initials` stay derived, not persisted, in both shapes.
      **Frozen-contract consequence — being built separately, do not duplicate it.**
      `features/personas/types.ts:91` declares `personaType` as a REQUIRED field of `Persona`, so the
      participant payload no longer structurally satisfies that TS type. Nothing breaks at runtime —
      `isValidPersona` does not check the field, and no participant surface reads it (its only readers
      are the staff console's `PersonaPicker.tsx`, `PersonaContextPanel.tsx` and
      `controller/services/personaVoice.ts`). The approved resolution is a participant/staff **type
      split** (`Persona` without `personaType`; a staff shape widening by that one field), in progress
      on branch `build/profiles-social-graph/persona-contract-split`. It is explicitly NOT "make
      `personaType` optional" — do not implement that variant.
- [x] **Seeder populates real state.** `PersonaCastSeeder` (`Features/Ops/EngineContentSeed/
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
- [x] **Impersonation pair + live-cast parity.** The seeded catalog gains the SOC-052 impersonation
      pair currently present only in the frontend mock (`personaTemplates.ts`) and absent from the
      live `PersonaCastSeeder.Catalog`: `@FairhavenWaterUpd` (org, `Verified = false`, display name
      `"Fairhaven Water Update"` — a near-identical lockup of the verified `"Fairhaven Water
      Utility"` / `@FairhavenWater`, recent `JoinedAt`) alongside the existing verified
      `@FairhavenWater`. Also add `@TheScoopHQ` (org, unverified, `influencer` type) and
      `@dreyes_fh` (human, unverified, `citizen` type) so the live nine-persona cast matches the
      frontend's nine-template cast handle-for-handle. Matching the platform's own rule (D1-008),
      the seeder never marks or flags the lookalike in any field — the absent `Verified` flag is the
      only signal, exactly as every other unverified persona is represented.
      **Re-review (WR-C): the archetype vocabulary is closed and validated.** `DeriveJoinedAt`'s
      non-bad-actor branch is the 90-729-day ESTABLISHED-account branch, so a mis-cased or typo'd
      archetype falling through it would ship the lookalike with a two-year-old account — this AC's
      tell inverted, silently. An archetype outside the frozen `PersonaType` union now throws, both at
      the derivation and at the seeder's authoring-time (static-constructor) guard, symmetrically with
      the band vocabulary.
      **AMENDED (Gate-1 WR-002) — the engine cannot voice them: `Persona.Castable`.**
      `engine-content-seed`'s standing objection to seeding a bad-actor voice ("content the platform
      has no way to turn off") is answered with a real gate rather than an ordering heuristic:
      `@FairhavenWaterUpd` and `@TheScoopHQ` are seeded with `Castable = false`, so the ROWS exist
      (participants can browse the lookalike's profile — the SOC-052 training material) while
      `EngineContentSeedService` filters them out of the reaction loop's eligible cast and the starter
      storyline's participating personas. A scenario opts in by flipping the column. The flag is
      server-side only and is projected onto **no** DTO, participant or staff — a `castable` field on
      the wire would be the same machine-readable lookalike tell as `personaType`.
      **Re-review (WR-B): reuse reconciles the gate ONE WAY.** A row that is castable while the catalog
      says it must not be is closed on re-seed (`true → false`); the reverse never happens. The seeder
      may only ever TIGHTEN this gate — closing a wrongly-open one costs a withheld engine voice
      (visible, recoverable), opening a closed one would hand the engine a voice a human deliberately
      withheld. Accepted cost: a scenario that opted the lookalike IN by flipping the column is
      overridden on the next re-seed; when a real opt-in surface exists it must live somewhere the
      seeder does not own (a scenario-level allowlist), not in this column alone. An opt-OUT of an
      ordinarily-castable persona is preserved.
- [x] **No new leak (XC-002).** Exercise scope (COR-001) is unchanged — every new field is exposed
      only through the existing exercise-scoped `GET /api/personas` read, with no new provenance/
      operator/session-attribution field added to either DTO, and no participant-reachable field that
      distinguishes the lookalike other than `verified` (see AC2/AC4 as amended).
- [x] **Idempotent seeding.** Re-running the seeder for an already-seeded exercise does not duplicate
      rows or overwrite an existing row's fields (mirrors the seeder's existing `(ExerciseId,
      Handle)`-keyed idempotency, `IX_Personas_ExerciseId_Handle`) — the three new catalog handles
      are added on the first re-seed of an exercise that predates them, without disturbing the six
      that already exist.
      **AMENDED (Gate-1 CR-001) — one bounded exception: the sentinel backfill.** A reused row whose
      `AudienceMagnitude == 0` **and** `JoinedAt == SeedEpoch` is backfilled once with its catalog
      archetype/band and derived magnitude/join instant (`Bio` only when absent, via `??=`). That pair
      is a state **no authored row can hold** — the derivation never returns a magnitude below the
      smallest band floor (450) and always subtracts at least three days from the epoch — so it means
      exactly one thing: the row predates these columns and is carrying the migration's defaults.
      Without the backfill the six pre-existing personas would read as joining ON the epoch
      (2026-06-15) while the newly seeded lookalike derives 2026-06-09, making the **impersonator look
      like the older, more established account** and inverting the very SOC-052 "joined this week"
      tell this story exists to create. Any row holding authored values is still never overwritten.
      **Re-review (S-B): every mutation to an existing row is REPORTED.** `personasBackfilled` and
      `personasCastableClosed` (subsets of `personasReused`, not additions to it) are returned on the
      seed response, written into the `engine.content_seeded` XC-004 payload, and logged once per seed
      when non-zero; the response `note` also says so in plain language. A re-seed now reports
      "6 reused, 6 backfilled" rather than a flat "6 reused" — the flat count is precisely what let
      CR-001 hide for a whole review cycle.

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

**Sanitization is a call-site guarantee, not a type guarantee (Gate-1 S-003).** `PostSanitizer` runs at
the seeder's ingest boundary — it is NOT enforced by the `Persona` entity, EF, or the DTO. Every FUTURE
`Bio` writer (planner template authoring COR-020, mid-exercise persona creation COR-022, any import or
staff edit) must strip-not-encode through the same funnel at its own boundary before assigning, because a
stored bio renders on a participant profile (NFR-004). This is recorded on `Persona.Bio`'s XML docs as
well, so the obligation travels with the property.

**`DeriveJoinedAt`/`DeriveAudienceMagnitude` THROW on a value outside their closed vocabulary — do not call
them from a request handler over database-sourced input.** Both are authoring-time helpers: an unrecognized
archetype or band is a bug that must fail loudly, because the alternative (`DeriveJoinedAt`'s `else` branch)
silently gives a bad actor an established two-year-old account and inverts the SOC-052 tell. The consequence
to plan for: a legacy/hand-edited row carrying an out-of-union `PersonaType` read back from the database
would THROW rather than derive. That posture is deliberate and is to be kept — so a future persona-authoring
path (COR-020 template authoring, COR-022 mid-exercise creation, an import) must validate the archetype at
its own ingest boundary and surface a 400, rather than passing a stored value straight into these helpers
inside a request handler and turning a bad legacy row into a 500.

**Per-world projection seam (Gate-1 WR-001).** The staff/participant split is a role branch on the
EXISTING `GET /api/personas`, not a new staff endpoint: the staff console's `PersonaPicker.tsx` /
`PersonaContextPanel.tsx` reach personas through `usePersonas()` → `resolvePersonas()` → `/personas`, and
the shared axios instance already attaches the staff bearer token, so staff keeps `personaType` with **no
frontend edit at all**. A separate `/api/staff/personas` would have required editing those frozen
frontend files (forbidden this wave) or shipping an endpoint nobody calls.

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

**Real projection, unchanged contract (AC2, incl. the WR-001 per-world split)**
- `PersonaResponseDtoTests.FromPersona_ProjectsThePersistedPresentationValues_NotTheB1StandIns`
- `PersonaResponseDtoTests.FromPersona_KeepsAvatarColorAndInitials_DerivedAndStable`
- `PersonaResponseDtoTests.FromPersona_NullBio_OmitsTheKeyEntirely_RatherThanEmittingNull`
- `PersonaResponseDtoTests.FromPersona_StructurallyOmitsPersonaType_TheImpersonatorTellStaysStaffOnly`
- `PersonaResponseDtoTests.StaffFromPersona_CarriesPersonaType_AndTheSameParticipantFields`
- `PersonaResponseDtoTests.StaffFromPersona_NeverProjectsTheCastableGate`
- `PersonaResponseDtoTests.FromPersona_JoinedAt_MatchesJavaScriptToISOString_ForANonUtcOffsetToo` (WR-004 —
  the wire instant is byte-identical to the mock's `toISOString()`)
- `PersonaEndpointsTests.Response_ProjectsThePersistedPresentationFields_NotTheB1StandIns` [docker] — over
  HTTP, incl. the exact participant wire field-set (participant-safe fields + the optional `bio`, no
  `personaType`)
- `PersonaEndpointsTests.StaffSession_ReceivesPersonaType_ParticipantDoesNot` [docker] — one row, one
  endpoint, two shapes: an anonymous caller vs. a live staff-kind session
- `PersonaEndpointsTests.ExpiredStaffSession_FallsBackToTheParticipantShape_FailClosed` [docker]

**Seeder populates real state (AC3)**
- `PersonaCastSeederTests.SeedAsync_PopulatesEveryPresentationField_ForEveryPersona` [docker]
- `PersonaCastDerivationTests.DeriveAudienceMagnitude_MatchesTheFrontendMock_ForTheSameHandleAndBand`
  (per-handle parity with `seedCast.ts`), `..._StaysWithinTheBandsFloorPlusForty` (the `BAND_BASE` band
  ranges), `..._IsDeterministic_AndBandOrdered`, `..._UnknownBand_Throws_RatherThanInventingANumber`
- `PersonaCastDerivationTests.Catalog_PassesItsAuthoringTimeGuard_BiosBandsArchetypesAndPositiveFloors`
  (S-002 + WR-C + S-A — the positive-floor invariant keeps the CR-001 sentinel structurally unreachable)
- `PersonaCastDerivationTests.DeriveAudienceMagnitude_RejectsAnythingOutsideTheClosedBandVocabulary` (S-001)
- `PersonaCastDerivationTests.DeriveJoinedAt_RejectsAnArchetypeOutsideTheClosedUnion_NeverSilentlyEstablishes`
  (WR-C — replaces the earlier test that pinned the silent fallthrough as intended)
- `PersonaCastDerivationTests.DeriveJoinedAt_EveryArchetypeInTheClosedUnion_IsAccepted` (WR-C, the other half)
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
- `PersonaResponseDtoTests.FromPersona_NeverFlagsAnUnverifiedLookalike_TheAbsentSealIsTheOnlySignal` — the
  bad-actor and the citizen payloads are byte-identical; only `verified` may ever differ
- `PersonaCastSeederTests.SeedAsync_MarksTheBadActorAndLowCredibilityAccounts_NonCastable_EveryoneElseCastable`
  [docker] (the WR-002 `Castable` gate at the row level)
- `EngineContentSeedServiceTests.Seed_EligibleCast_ExcludesTheNonCastablePersonas_TheEngineCannotVoiceTheImpersonator`
  [docker] — the rows exist, but neither the eligible cast nor the storyline can voice them
- `PersonaCastSeederTests.SeedAsync_ReusedRow_ReportsAndPersistsCastability_ClosingAWronglyOpenGate` [docker]
  (WR-B — an intermediate-build row carrying the column default `true` is closed and REPORTED closed)
- `PersonaCastSeederTests.SeedAsync_ReusedRow_NeverReOpensAGateAHumanClosed` [docker] (WR-B, one-way only)
- `EngineContentSeedServiceTests.Seed_OverAnUnmigratedLookingCast_ReportsBackfillAndGateClosure_InTheResponseAndTheAuditEvent`
  [docker] (S-B — the counts appear in the result, the response DTO + its note, and the XC-004 payload)
- `EngineContentSeedServiceTests.Seed_EmitsExactlyOneContentSeededEvent_InTheSameUnitOfWork` /
  `..._RunTwice_ReusesPersonas_...` [docker] — the audit keys are always present, and an ordinary re-seed
  reports zero mutations

**No new leak (AC5)**
- `PersonaEndpointsTests.WiderProjection_StillLeaksNothingAcrossExercises_ScopeA_NeverSeesBsPresentationFields`
  [docker] — extends the standing isolation suite (`exercise-isolation/07`)
- `PersonaEndpointsTests.Response_ContainsOnlyShippedPersonaFields_NoProvenanceOrOperatorLeak` [docker]
  (existing, still green), `PersonaResponseDtoTests.FromPersona_CarriesNoProvenanceOrOperatorField_XC002`

**Idempotent seeding (AC6, incl. the CR-001 sentinel backfill)**
- `PersonaCastSeederTests.SeedAsync_RunAgain_CreatesNoDuplicates_AndReturnsTheSameIds` [docker]
- `PersonaCastSeederTests.SeedAsync_RowCarryingOnlyTheColumnDefaults_IsBackfilled_SoTheImpersonatorStaysTheNewestAccount`
  [docker] — pins the corrected behaviour: after a re-seed the lookalike is still the NEWEST account
- `PersonaCastSeederTests.SeedAsync_NeverOverwritesAuthoredValues_OnlyTheSentinelPair` [docker] — the
  exception stays bounded
- `PersonaCastSeederTests.SeedAsync_AgainstAnExercisePredatingTheNewHandles_AddsExactlyThoseThree_AndDisturbsNothing`
  [docker]
- `EngineContentSeedServiceTests.Seed_ResolvesExistingExercise_SeedsNinePersonas_AndRegistersTheLoop` /
  `EngineContentSeedServiceTests.Seed_RunTwice_ReusesPersonas_AndReplacesRegistration_NeverDuplicates`
  [docker] (updated 6 → 9)
