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
- [x] Given a planner with a staff session, when they open the exercise-settings panel and save, then
      the per-exercise settings named in COR-030 — internal name, participant-visible world name/locale,
      time zone, schedule, enabled channels, theming — persist on the `Exercise` row and survive a
      reload. *(Compliance-chrome config is story 02; the column ships in this story's migration.)*
- [x] Given a saved settings change, when a participant calls `GET /api/brand-tokens` or
      `GET /api/channel-nav-config`, then the response carries that exercise's configured values
      **in the existing frozen wire shapes, byte-for-byte compatible** (`BrandTokensResponse`,
      `ChannelNavConfigResponse` in `ParticipantShellDtos.cs`) — the hardcoded constants are replaced,
      no DTO is reshaped, and no frontend consumer or runtime type-guard changes.
- [ ] Given the enabled-channel setting, when a channel is disabled for the exercise, then it is
      reported `enabled: false` in the channel catalog **(delivered in Phase 1 — Social enabled,
      E3–E6 catalogued-but-off)**, and, **when a disabled channel's own participant routes exist, they
      refuse to serve it**. The second clause is **not delivered by this story** and does not hold today
      — see "Known gap: channel-enablement route gating" below. It lands with the E3–E6 channel routes
      (each channel epic), which do not exist yet.
- [x] Given an exercise, when its time zone is read, then it is a single IANA zone per exercise (XC-008,
      known constraint) and is the zone every participant-visible timestamp renders in (COR-053) —
      including the value already served on `ExerciseScope.timeZone`.
- [x] **Isolation (XC-001/002, COR-001/007):** given a staff or participant request, when settings are
      read or written, then the exercise is taken from the server-resolved scope (`IExerciseContext` /
      the staff active-exercise selection) and never from a client-supplied parameter; a cross-exercise
      settings read or write returns 403/404 and the case extends the standing isolation suite.
- [x] **Content security (NFR-004):** given free-text settings that reach a participant surface (world
      name, brand name, outlet names), when they are saved, then they are length-bounded
      (`AccountFieldRules` pattern) and sanitized server-side **through the shipped
      `Features/Social/PostSanitizer.cs` — which strips markup and never entity-encodes** (encoding would
      double-encode ordinary text and break the fiction); a stored `<script>` in any of them never
      executes in a participant session, and no new sanitizer is hand-rolled.
- [x] Given a settings write, when it is rejected (invalid IANA zone, over-length text, unknown channel
      id), then the write fails closed with a 400 and the stored config is unchanged.
- [x] **Vocabulary widening (Option B, Tier-2 signed off):** given the widened `Status` column, when an
      exercise's status is read, then it carries a COR-032 literal from `implementation.md`'s
      authoritative list; existing rows are mapped by the data migration; `PulseDbContext`'s default and
      `BootstrapService`'s seed use the new literals; and `ExerciseScopeDto.FromExercise` passes the
      value through unchanged.
- [x] **Client-first ordering (the split-deploy guard):** given the frontend guard widening is purely
      additive, when this story ships, then `EXERCISE_STATUSES` / `isExerciseStatus` accept **both** the
      legacy and the COR-032 vocabularies, and the frontend is deployed **no later than** the backend —
      so no deploy order can present an unknown status to a fail-closed client. Retiring the legacy four
      literals is a documented follow-up, not part of this story.
      *(The code half shipped in slice 01a; the deploy-order half is a release-time obligation on the
      UAT/prod rollout, not something a test can hold.)*
- [x] Given the watermark on/off flag, when it is stored, then it is a real per-exercise column story
      02's NFR-008 guard reads — not a constant.

### Known gap: channel-enablement route gating (unowned — needs filing)

AC3's second clause ("no participant route serves it") holds **only vacuously** today, and the gap is
real rather than theoretical:

- **E3–E6** (`portal`, `news`, `press`, `weather`) have no participant routes at all, so "no route
  serves a disabled channel" is trivially true for them. When each channel epic lands its routes, that
  epic must consult the enabled set — nothing in this story makes that automatic.
- **`social` DOES have routes.** A planner may `PUT { "enabledChannels": ["news"] }`, which correctly
  reports `social` as `enabled: false` on `GET /api/channel-nav-config` (the nav strip drops it), while
  `GET /api/feed`, `GET /api/threads/{postId}` and `POST /api/posts` keep serving normally. Only the
  navigation is withdrawn; the content is not.
- **Story 03 does not close this.** Its planned `UseExerciseLifecycleGating()` gates on the COR-032
  *lifecycle state* (`draft`/`staged`/`live`/`paused`/…), which is an orthogonal axis to *channel
  enablement*. A `live` exercise with `social` disabled passes lifecycle gating.

So **no story in this feature currently owns channel-enablement route gating.** It needs an owner —
either a shared participant-route filter that reads the enabled set (the seam this story's
`ChannelCatalog.ParseStored` already provides), or an explicit per-epic obligation recorded in each
channel epic. Until then, treat "disabled channel" as *"hidden from the nav"*, not *"unreachable"*.

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
- Contract: `/api/brand-tokens` and `/api/channel-nav-config` responses are still accepted by the
  frontend after the constants are gone. **Do not import the guards** — `isBrandTokens` and
  `isChannelNavConfigResponseBody` are module-private in a different, Complete feature. Instead drive
  the public hooks (`useBrandConfig()` / `useBrandTokens()`, `useChannelNav()`) through a mocked axios
  adapter returning the real response body, and assert the hook resolves *that* body rather than falling
  back to its default — a fallback is the private guard rejecting the shape.
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
| `exerciseContextResolver.test.ts` → `resolves a scope whose status is "%s"` (all **nine**) | AC-client-first ordering |
| `StaffHeader.test.tsx` → `status "%s" renders both a dot AND the text label` (all **nine**) | AC-client-first ordering + NFR-001 (a newly-emittable status is never color-only) |

### Shipped in slice 01b — backend (settings API + shell-config projection)

The staff editor's own tests are the frontend half of 01b and are listed in the table after this one.

| Test | AC |
|---|---|
| `ExerciseSettingsEndpointsTests.Put_PersistsEverySettingNamedInCor030_AndSurvivesAReload` | AC1 (settings persist + survive a reload) |
| `ExerciseSettingsEndpointsTests.Get_ResolvedExercise_ReturnsTheSettingsBlock_AndTheClosedChannelCatalog` | AC1 |
| `ExerciseSettingsEndpointsTests.Put_OmittedOptionalFields_ClearThemBackToNotConfigured` | AC1 (replace semantics), AC2 (a cleared setting returns to the shipped constant) |
| `ParticipantShellPerExerciseConfigTests.BrandTokens_ConfiguredExercise_ServesThatExercisesBrand_InTheFrozenShape` | AC2 (per-exercise values on the frozen `BrandTokensResponse`) |
| `ParticipantShellPerExerciseConfigTests.BrandTokens_PartiallyConfiguredExercise_FallsBackPerFieldToTheShippedConstants` | AC2 |
| `ParticipantShellPerExerciseConfigTests.BrandTokens_UnconfiguredExercise_ServesTheShippedConstantsUnchanged` | AC2 (no consumer/type-guard change) |
| `ParticipantShellEndpointsTests.*` (the six pre-existing wire-shape tests, unchanged) | AC2 (byte-for-byte compatible after the constants are gone) |
| `ParticipantShellPerExerciseConfigTests.ChannelNav_ConfiguredChannels_ReportsPerChannelEnabledFlags_AndAnEnabledCurrentChannel` | AC3 (a disabled channel is reported `enabled: false`) |
| `ParticipantShellPerExerciseConfigTests.ChannelNav_UnconfiguredExercise_KeepsThePhase1Default_SocialOnly` | AC3 (Phase 1: Social enabled, E3–E6 catalogued-but-off) |
| `ParticipantShellPerExerciseConfigTests.ChannelNav_UnparseableStoredValue_DegradesToThePlatformDefault_RatherThanBlankingTheShell` | AC3 |
| `ExerciseSettingsEndpointsTests.Put_DisablingAChannel_ReportsItEnabledFalse_OnTheParticipantCatalog` | AC3 (end to end: staff toggle → participant catalog) |
| `ExerciseSettingsFieldRulesTests.TryNormalizeTimeZone_AcceptsARealIanaZone` / `_RejectsAbsentUnknownAndWindowsZoneIds` | AC4 (a single IANA zone per exercise, XC-008) |
| `ExerciseSettingsServiceTests.UpdateAsync_StampsTheTelemetryEventFromTheServerClockAndTheExercisesTimeZone` | AC4 |
| `ExerciseSettingsEndpointsTests.Put_InExerciseA_NeverTouchesExerciseB_EvenWhenTheBodyNamesIt` | AC5 (isolation — a client-supplied id has nowhere to bind) |
| `ExerciseSettingsEndpointsTests.Get_InExerciseA_NeverReturnsExerciseBsSettings` | AC5 |
| `ExerciseSettingsServiceTests.UpdateAsync_InExerciseA_LeavesExerciseBByteForByteUnchanged` | AC5 |
| `ExerciseSettingsServiceTests.GetAsync_ResolvedScopeWithNoExerciseRow_ReturnsNotFound_NotAnotherExercisesRow` | AC5 (the IDOR case on an unfiltered table) |
| `ExerciseSettingsServiceTests.GetAsync_UnresolvedScope_FailsClosed_WithoutTouchingTheDatabase` / `GetAsync_EmptyGuidScope_FailsClosed` / `UpdateAsync_UnresolvedScope_FailsClosed_AndWritesNothing` | AC5 (fail closed) |
| `ExerciseSettingsEndpointsTests.Get_NoStaffSession_Returns401_FailClosed` / `Put_NoStaffSession_Returns401_AndWritesNothing` / `Get_StaffNotAssignedToTheResolvedExercise_Returns403_FailClosed` / `Get_UnresolvedScope_Returns401_FailClosed` | AC5 (XC-002 staff gate) |
| `ParticipantShellPerExerciseConfigTests.BrandTokens_ExerciseA_NeverServesExerciseBsBrand` / `ChannelNav_ExerciseA_NeverReportsExerciseBsChannelSelection` | AC5 (participant-facing reads extend the standing isolation suite) |
| `ParticipantShellPerExerciseConfigTests.AllEndpoints_UnresolvedScope_Return401_NeverEmptyOkConfig` / `AllEndpoints_EmptyGuidScope_Return401_BecauseAnUnsetScopeCollapsesToGuidEmpty` | AC5 (the pre-refactor fail-closed 401 is preserved) |
| `ExerciseSettingsEndpointsTests.Put_MarkupInFreeText_IsStrippedNotEncoded_AllTheWayToTheParticipantSurface` | AC6 (NFR-004 — strips, never entity-encodes) |
| `ExerciseSettingsEndpointsTests.Put_AllMarkupBrandName_Returns400_RatherThanStoringAnEmptyBrand` | AC6 |
| `ExerciseSettingsFieldRulesTests.TryNormalizeWorldName_StripsMarkupAndKeepsTheAuthorsLiteralCharacters` / `TryNormalizeBrandName_RejectsAValueThatIsEntirelyMarkup` / `TryNormalizeOutletNames_SanitizesBothKeysAndValues` / `_RejectsAnEntryEmptiedBySanitizing` | AC6 |
| `ExerciseSettingsEndpointsTests.Put_InvalidTimeZone_Returns400_AndLeavesTheStoredConfigUnchanged` | AC7 (invalid IANA zone → 400, stored config unchanged) |
| `ExerciseSettingsEndpointsTests.Put_UnknownChannelId_Returns400_AndLeavesTheStoredConfigUnchanged` / `Put_EmptyEnabledChannels_Returns400_RatherThanBlankingTheParticipantWorld` | AC7 (unknown channel id) |
| `ExerciseSettingsEndpointsTests.Put_OverLengthWorldName_Returns400` / `Put_MissingName_Returns400` / `Put_MalformedColor_Returns400` / `Put_MissingBody_Returns400` | AC7 (over-length text, malformed color) |
| `ExerciseSettingsServiceTests.UpdateAsync_InvalidRequest_RejectsBeforeAnythingIsApplied_AndEmitsNoTelemetry` | AC7 |
| `ExerciseSettingsFieldRulesTests.TryNormalize_*` / `ParseStored_*` / `Format_RoundTripsThroughParseStored` / `TryNormalizeColor_*` / `TryNormalizeLocale_*` | AC7 (the strict parser over a column with no DB-level integrity) |
| `ExerciseSettingsFieldRulesTests.UpdateExerciseSettingsRequest_CarriesNoExerciseIdProperty_SoAClientCannotAimAWriteElsewhere` | AC5 (structural, not merely enforced) |
| `ExerciseSettingsFieldRulesTests.ExerciseSettingsDto_SerializesTheDocumentedCamelCaseWireKeys` / `_CarriesNoStaffOnlyOrParticipantHiddenState` | AC1, AC2 (XC-002 — no story-02/04 state leaks onto this shape) |
| `ExerciseConfigurationProjectionRegistrationTests.AddExerciseConfiguration_RegistersTheSlicesServicesAtScopedLifetime` / `_RegistersEachProjectionDefaultExactlyOnce_AsTheConstantPreservingFloor` / `_CalledTwice_StillRegistersOneProjectionDescriptor` / `ContributedProjection_RegisteredWithReplace_WinsOverTheDefault_InTheOrchestratorsOrder` / `_WinsEvenWhenItRunsBeforeTheDefault` / `ContributedProjection_RegisteredWithTryAdd_IsSilentlyIgnored_WhichIsWhyReplaceIsMandatory` | AC2 + implementation.md "The projection-override contract" (the **DI half** of the wave-3 seam) |
| `ExerciseConfigurationCompositionTests.WithoutAContributor_ChromeConfig_ServesTheShippedConstants_EndToEnd` / `ContributedProjection_RegisteredWithReplace_ReachesTheRealEndpoint_EndToEnd` / `ContributedShellVariantAndOverlayProjections_ReachTheirRealEndpoints_EndToEnd` | AC2 + the projection-override contract (the **end-to-end half** — a contributed projection reaching the real HTTP response) |
| `ExerciseSettingsEndpointsTests.Put_EmitsExactlyOneSettingsUpdatedTelemetryEvent_ListingTheChangedFields` / `Put_ThatChangesNothing_PersistsNothingAndEmitsNoTelemetry` / `ExerciseSettingsServiceTests.UpdateAsync_PersistsTheMutationAndItsTelemetryEventInExactlyOneSaveChanges` | XC-004 (one event per meaningful action, same unit of work) |
| `ExerciseSettingsFieldRulesTests.TryNormalizeInstant_AnOffsetlessInstant_IsReadAsUtc_NotTheHostsLocalZone` / `_AnExplicitOffset_KeepsTheInstant_AndNormalizesItToUtc` | AC1 (WR-004 — the schedule stores the instant the caller meant, not one shifted by the host's zone), AC4 |
| `CompositionRootWiringTests.ProgramCs_CallsAddExerciseConfiguration_SoTheParticipantShellHandlersCanResolveTheirService` / `_SoTheThreeWave3ProjectionSeamsHaveTheirDefaults` / `ProgramCs_MapsTheStaffExerciseSettingsRoutesExactlyOnce` | AC1, AC2 (the composition-root wiring the six converted participant reads and the staff editor both depend on) — see the note below |

> **These three were RED by design until the orchestrator wired `Program.cs` — that wiring has now
> landed and they are GREEN.** They boot the real `Program` host with NO test-service override and
> assert the slice is registered and mapped there. Every other Program-booted host in the suite
> (`SocialApiWebApplicationFactory`) calls `AddExerciseConfiguration()` itself, so this file is the only
> place a missing composition-root line is observable — which is the whole point (login #310 → #317).
> **They are now a standing regression guard:** deleting either `builder.Services.AddExerciseConfiguration()`
> or `app.MapExerciseConfigurationEndpoints()` from `Program.cs` turns them red.

> **The projection guards live in TWO classes — cite the right one.** The six pure-DI tests were moved
> out of `ExerciseConfigurationCompositionTests` into
> **`ExerciseConfigurationProjectionRegistrationTests`** (test *names* unchanged; only the class moved),
> because they are bare `ServiceCollection` assertions that touch no database and were hard-failing on a
> Docker-less host inside the SQL collection fixture. `ExerciseConfigurationCompositionTests` keeps the
> three genuinely end-to-end cases, gated `[RequiresDockerFact]` so they skip cleanly. A wave-3
> contributor writing its own DI-resolution AC test should copy the **ProjectionRegistration** shape
> (plain `[Fact]`, no fixture) for the registration half, and the **Composition** shape for the
> real-endpoint half.

### Shipped in slice 01b — frontend (staff editor)

`ExerciseSettingsPanel.test.tsx` (33 tests) and `exerciseSettingsService.test.ts` (18) — 51 in total.
The `useExerciseSettings` hook has no separate file: it is driven through the panel, which is where its
read/mutation/invalidate behaviour is observable.

| Test | AC |
|---|---|
| `ExerciseSettingsPanel — the FULL-REPLACE round trip` → `submits every managed field, unchanged, when nothing has been edited` / `editing ONE field does not clear the others (PUT is a replace, not a patch)` / `keeps the brand, schedule, channels and outlet names when only the name changes` / `preserves an outlet-name key that falls outside the channel catalog` | AC1 (every COR-030 setting round-trips; a save never silently clears a field the planner never touched) |
| `ExerciseSettingsPanel — load states` → `renders the loaded settings once the read resolves` | AC1 (the saved settings survive a reload, from the planner's side of the contract) |
| `ExerciseSettingsPanel — the FULL-REPLACE round trip` → `clears a setting only when the planner actually empties its field` / `reverts every edited field back to the server state` | AC1 |
| `ExerciseSettingsPanel — "not configured" renders EMPTY, never the shipped constant` → `shows an empty "%s" field when the server sent null` (5 cases) / `shows an empty scheduled end when the exercise is unscheduled` / `sends null — not an invented value — for a field left empty` | AC1, AC2 (an unconfigured column stays `null`, so the participant surface keeps falling back to the shipped constant) |
| `ExerciseSettingsPanel — "not configured" renders EMPTY, never the shipped constant` → `never pre-fills a participant fallback constant into an unconfigured field` | AC2 (the editor must not turn a participant-world fallback into stored configuration behind the planner's back) |
| `ExerciseSettingsPanel — the channel catalog comes from the response` → `renders one checkbox per catalogued channel, checked per the effective flags` / `renders WHATEVER catalog the server sends — no channel id is hardcoded client-side` / `submits the checked catalog ids, never an invented one` | AC1 (enabled channels), AC7 (the closed catalog is the server's; the client can never coin an id the write would reject) |
| `exerciseSettingsService.test.ts` → `returns the FULL closed channel catalog in the order the server sent it` | AC1 (enabled channels) |
| `ExerciseSettingsPanel — accessibility (NFR-001)` → `associates the IANA time-zone error with the time-zone field, and blocks the write` | AC4 (a single IANA zone per exercise, XC-008 — surfaced on the field that owns it) |
| `exerciseSettingsService.test.ts` → `getExerciseSettings — request shape (COR-001…)` → `GETs the fixed staff route with no exercise id in the URL and no arguments at all` / `updateExerciseSettings…` → `never sends an exercise id — the write has nowhere to bind but the resolved scope` | AC5 (isolation — the client cannot name an exercise, so there is no cross-exercise vector to defend against at the seam) |
| `exerciseSettingsService.test.ts` → `carries the %s status through with an empty body` (401/403/404) · `ExerciseSettingsPanel — load states` → `surfaces a %s load failure in an alert with an icon, never color alone` (401/403) | AC5 (the staff gate's fail-closed statuses reach the planner as a refusal, never as an empty-but-successful form), NFR-001 |
| `ExerciseSettingsPanel — the FULL-REPLACE round trip` → `re-renders from the SERVER RESPONSE after a save, not from local form state` | AC6 (NFR-004 — the server's stripped value is what the editor shows; the client never re-asserts the markup it submitted) |
| `exerciseSettingsService.test.ts` → `returns the server re-projection, not the submitted body (the server normalizes)` | AC6, AC1 |
| `ExerciseSettingsPanel — server rejection (400: nothing was persisted)` → `surfaces the single server reason in an alert (icon + text, never color alone)` / `keeps the planner’s edits on screen so a rejected save is recoverable` / `reports a network failure distinctly from a rejection` | AC7 (a rejected write persists nothing and says why), NFR-001 |
| `ExerciseSettingsPanel — the channel catalog comes from the response` → `blocks a save that would enable no channels at all (an empty list is a 400)` | AC7 (the client refuses the write the server would 400, rather than blanking the participant world) |
| `ExerciseSettingsPanel — accessibility (NFR-001)` → `associates a required-field error with its field (aria-invalid + aria-describedby)` / `associates a malformed-color error with its own field` / `rejects an end date that precedes the start, on the end field` / `announces that a blocked save never reached the server` | AC7 (the same rules as the server's 400s, enforced before the request), NFR-001 |
| `exerciseSettingsService.test.ts` → `fails closed on %s rather than casting it into settings` (5 cases) / `fails closed on a malformed 200 body` / `extracts the 400 reason from the BARE JSON STRING body the endpoint returns` / `reports an undefined status when the request never reached a response` / `wraps a non-axios throw rather than leaking it` | AC7 (fail closed on any body that is not the contract — never cast an unknown shape into settings) |
| `ExerciseSettingsPanel — accessibility (NFR-001)` → `gives every control a real label` · `ExerciseSettingsPanel — load states` → `announces loading in a status region while the settings are in flight` · `— the FULL-REPLACE round trip` → `announces a successful save in a status region (icon + text)` | NFR-001 (WCAG 2.1 AA — labelled controls, live regions, and state signalled by icon + text, never color alone) |
| `exerciseSettingsService.test.ts` → `PUTs the whole body to the fixed staff route` / `returns the settings block with its nulls intact (a null is "not configured")` | AC1 (the wire contract the panel's round trip rests on) |

> **Follow-up for whoever next touches `exerciseContextResolver.test.ts`:** the shipped test is named
> `exposes exactly the ten literals of the transitional superset`. The superset is **nine** — six COR-032
> values plus the legacy four, with `archived` shared by both — which is what `EXERCISE_STATUSES` and the
> assertion itself actually carry. Only the test *name* is wrong. It is not edited here because that file
> belongs to no story in this feature's current wave; rename it opportunistically.
