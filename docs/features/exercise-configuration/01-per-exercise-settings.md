# Story: Per-exercise settings

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
*(slice **01a** — schema + COR-032 vocabulary + the client guard — has shipped; the flip to Complete belongs to slice **01b**, the settings API + shell-config service + staff editor.)*
**Requirements:** COR-030 (XC-008)  ·  **Design decisions:** none  ·  **Issue:** #67

## Context
The per-exercise settings that define a world: internal name, participant-visible world name/locale,
time zone (single zone per exercise), schedule, enabled channels (Social/News/Press/Weather), theming
(portal branding, outlet names), and compliance chrome config (COR-030).

**This is extend + expose, not invent.** `src/Pulse.WebApi/Data/Entities/Exercise.cs` already stores
`Name`, `TimeZone` (IANA, default `UTC`), `Hostname`/`BrandedDomain`, `Status` and a placeholder
`CurrentScenarioTime`, and `GET /api/exercise-context` already serves name + time zone on the frozen
`ExerciseScope` shape. What is missing is the *rest* of COR-030 (world name/locale, schedule, enabled
channels, theming) and any way for a planner to see or change any of it — today the participant-facing
values are **hardcoded constants** in `Features/ParticipantShell/ParticipantShellEndpoints.cs`
(`BrandTokens`, `ChannelNavConfig`).

This story also **owns the feature's one EF migration** (see feature.md "Single-migration rule"): the
columns stories 02 (chrome config + the watermark on/off flag), 03 (lifecycle) and 04 (practice flag)
need are authored here, in the same migration, even though their *behavior* lands in those stories.

### It also carries the story-03 vocabulary widening (Option B, Tier-2 signed off)

The human chose **Option B** for the COR-032 lifecycle reconciliation (see `03-exercise-lifecycle.md`)
and **gave the Tier-2 sign-off**. Because the sole-migration-author rule lives here, the `Status` column
change travels in *this* story's migration, not story 03's:

- widen `Exercise.Status` to the COR-032 vocabulary (the authoritative literals are in
  `implementation.md` → "Lifecycle string literals"), including `PulseDbContext`'s `HasDefaultValue`
  and `BootstrapService`'s seed value, plus a data migration mapping existing rows;
- widen the **frontend** guard (`EXERCISE_STATUSES` / `isExerciseStatus` / the `ExerciseStatus` union in
  `core/exerciseContext/exerciseContextResolver.ts`) **first**, additively, so a deployed client accepts
  the new values *before* any backend emits them;
- let `ExerciseScopeDto.FromExercise` pass the widened vocabulary through unchanged.

This deliberately reaches into files nominally owned by `exercise-isolation/08` (the `ExerciseScopeDto`
/ resolver seam). **That is sanctioned by the Tier-2 sign-off — it is the entire point of Option B** and
is not a scope violation to be flagged at review.

**The residual risk this must defend against:** UAT is a split deployment (Azure SWA frontend + App
Service backend) that deploys independently. A backend-ahead-of-frontend deploy writes `staged` /
`live` / `paused` into a client whose `isExerciseStatus` guard **fails closed on unknown values** — a
blank participant world, not a type error. The mitigation is ordering discipline, and it is cheap
because the client change is purely additive.

## Acceptance Criteria
- [ ] Given a planner with a staff session, when they open the exercise-settings panel and save, then
      the per-exercise settings named in COR-030 — internal name, participant-visible world name/locale,
      time zone, schedule, enabled channels, theming — persist on the `Exercise` row and survive a
      reload. *(Compliance-chrome config is story 02; the column ships in this story's migration.)*
- [ ] Given a saved settings change, when a participant calls `GET /api/brand-tokens` or
      `GET /api/channel-nav-config`, then the response carries that exercise's configured values
      **in the existing frozen wire shapes, byte-for-byte compatible** (`BrandTokensResponse`,
      `ChannelNavConfigResponse` in `ParticipantShellDtos.cs`) — the hardcoded constants are replaced,
      no DTO is reshaped, and no frontend consumer or runtime type-guard changes.
- [ ] Given the enabled-channel setting, when a channel is disabled for the exercise, then it is
      reported `enabled: false` in the channel catalog and no participant route serves it (Phase 1:
      Social enabled; E3–E6 channels catalogued-but-off).
- [ ] Given an exercise, when its time zone is read, then it is a single IANA zone per exercise (XC-008,
      known constraint) and is the zone every participant-visible timestamp renders in (COR-053) —
      including the value already served on `ExerciseScope.timeZone`.
- [ ] **Isolation (XC-001/002, COR-001/007):** given a staff or participant request, when settings are
      read or written, then the exercise is taken from the server-resolved scope (`IExerciseContext` /
      the staff active-exercise selection) and never from a client-supplied parameter; a cross-exercise
      settings read or write returns 403/404 and the case extends the standing isolation suite.
- [ ] **Content security (NFR-004):** given free-text settings that reach a participant surface (world
      name, brand name, outlet names), when they are saved, then they are length-bounded and sanitized
      server-side, and a stored `<script>` in any of them never executes in a participant session.
- [ ] Given a settings write, when it is rejected (invalid IANA zone, over-length text, unknown channel
      id), then the write fails closed with a 400 and the stored config is unchanged.
- [ ] **Vocabulary widening (Option B, Tier-2 signed off):** given the widened `Status` column, when an
      exercise's status is read, then it carries a COR-032 literal from `implementation.md`'s
      authoritative list; existing rows are mapped by the data migration; `PulseDbContext`'s default and
      `BootstrapService`'s seed use the new literals; and `ExerciseScopeDto.FromExercise` passes the
      value through unchanged.
- [ ] **Client-first ordering (the split-deploy guard):** given the frontend guard widening is purely
      additive, when this story ships, then `EXERCISE_STATUSES` / `isExerciseStatus` accept **both** the
      legacy and the COR-032 vocabularies, and the frontend is deployed **no later than** the backend —
      so no deploy order can present an unknown status to a fail-closed client. Retiring the legacy four
      literals is a documented follow-up, not part of this story.
- [ ] Given the watermark on/off flag, when it is stored, then it is a real per-exercise column story
      02's NFR-008 guard reads — not a constant.

## Out of Scope
Compliance chrome config + its editor (story 02 — this story ships only the column); the lifecycle
state machine and its transitions (story 03 — this story ships only the column); the practice flag's
behavior (story 04 — this story ships only the column); the actual theming/skin implementation per
surface (each channel epic); multi-time-zone support (deferred, open question 4); reshaping any frozen
DTO; alert content on `GET /api/alerts` (Phase 3).

## Technical Notes
**Staff world (COBRA)** for the editor — `@/theme/styledComponents`, FontAwesome only, MUI 9 `sx`-only;
it lives in the existing `src/frontend/src/features/planner/` surface and must never mount a participant
brand theme. The **served** values are participant-world data, but this story adds no participant UI.

Backend: a new `src/Pulse.WebApi/Features/ExerciseConfiguration/` slice following the existing
minimal-API `Add*()`/`Map*()` convention; `Program.cs` wiring is orchestrator-owned. This story also
performs the **constants → per-exercise service refactor** of `ParticipantShellEndpoints.cs` for all six
handlers (stories 02 and 03 then fill their own projections behind that seam) — see the in-flight
collision note in implementation.md. See implementation.md (slices 01a/01b).

## Dependencies
`Exercise` entity + `PulseDbContext` central filter (`exercise-isolation` 01/08, merged); staff session
+ active-exercise selection (`identity-auth-roles` 03/05, merged). Consumed by `exercise-clock` (TZ),
every channel (enablement/theming), and stories 02/03/04 (which build on this story's migration).

## Tests
- Integration: settings persist per exercise; a disabled channel is reported `enabled: false`.
- Contract: `/api/brand-tokens` and `/api/channel-nav-config` responses still satisfy the frontend
  runtime type-guards (`isBrandTokens`, `isChannelNavConfigResponseBody`) after the constants are gone.
- Isolation: a cross-exercise settings read/write is refused; added to the standing isolation suite.
- Sanitization: a `<script>` payload in world name / brand name is neutralized end to end.
- Vocabulary: `isExerciseStatus` accepts every COR-032 literal **and** every legacy literal (the
  transitional superset — this is what makes the deploy order safe); `ExerciseScopeDtoTests`'
  `[InlineData]` set is extended with the six new values.
- Data migration: existing rows land on the mapped COR-032 literals; `MigrationRoundTripTests`' default
  expectation is updated to the new `HasDefaultValue`.

### Shipped in slice 01a (schema + vocabulary + guard)

The settings API/editor, the constants→per-exercise projection, isolation and sanitization tests belong
to slice **01b** and are not listed below — 01a ships the schema, the vocabulary and the client guard.

| Test | AC |
|---|---|
| `MigrationRoundTripTests.Exercise_RoundTrips_WithExerciseConfigurationColumns` | AC1 (the COR-030 settings columns persist), AC-watermark |
| `MigrationRoundTripTests.Exercise_RoundTrips_WithUnconfiguredSettings_CarryingSafeDefaults` | AC1, AC-watermark (real column, safe default) |
| `MigrationRoundTripTests.Exercise_RoundTrips_WithDefaultTimeZoneAndStatus_WhenNotSet` | AC-vocabulary (`PulseDbContext`'s new `HasDefaultValue`), AC4 (single IANA zone) |
| `ExerciseConfigurationMigrationTests.Up_MapsEveryLegacyStatusOntoItsCor032Replacement` | AC-vocabulary (existing rows are mapped by the data migration) |
| `ExerciseConfigurationMigrationTests.Up_LeavesRowsAlreadyOnTheCor032Vocabulary_Untouched` | AC-vocabulary |
| `ExerciseConfigurationMigrationTests.Up_BackfillsPreExistingRows_WithSafeSwitchDefaults_AndNullSettings` | AC1, AC-watermark |
| `ExerciseConfigurationMigrationTests.Down_ReturnsEveryRowToTheLegacyVocabulary` | AC-client-first ordering (a rollback strands no client) |
| `ExerciseScopeDtoTests.Status_SerializesAsTheLowercaseExerciseStatusString` (9 `[InlineData]`) | AC-vocabulary (`FromExercise` passes it through unchanged) |
| `ExerciseScopeDtoTests.Serialized_KeepsTheFrozenFourKeys_WhenACor032StatusFlowsThrough` | AC2 (no DTO is reshaped) |
| `BootstrapServiceTests.Bootstrap_EmptyDatabase_CreatesHostBoundLiveExercise` | AC-vocabulary (`BootstrapService`'s seed uses the new literals) |
| `BootstrapServiceTests.Bootstrap_SeedsAnExerciseThatStillResolves_AndProjectsOntoTheFrozenScopeShape` | AC-vocabulary, AC2 |
| `exerciseContextResolver.test.ts` → `isExerciseStatus — the transitional superset` (accepts the six + the legacy four; rejects coined variants, wrong case, non-strings) | AC-client-first ordering |
| `exerciseContextResolver.test.ts` → `resolves a scope whose status is "%s"` (all ten) | AC-client-first ordering |
| `StaffHeader.test.tsx` → `status "%s" renders both a dot AND the text label` (all ten) | AC-client-first ordering + NFR-001 (a newly-emittable status is never color-only) |
