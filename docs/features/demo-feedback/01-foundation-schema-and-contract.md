# Story: Foundation: schema, contract, watermark flag

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-008 (watermark to the participant client), groundwork for DF-6, DF-7, DF-10, DF-12  ·  **Decisions:** DF-3, DF-6, DF-7, DF-10, DF-12  ·  **Issue:** #497
**Stack:** backend  ·  **Review:** **Tier-2** (schema)  ·  **Priority:** Must  ·  **Wave:** 0  ·  **Effort:** S

## Context

Stories 03, 04 and 05 each need a column or a table, and parallel builders must never fight over the EF model
snapshot. This story lands **the one migration** for the whole feature, plus the two small contract pieces other
stories read: the `noise` post origin and the `watermark` flag on the participant chrome config. Nothing here adds
an endpoint or behaviour beyond that. The frozen shapes are in [`implementation.md`](implementation.md#frozen-wire-contract).

## Acceptance Criteria

- [ ] **Given** the schema table in `implementation.md`, **then** one migration named `DemoFeedbackPinsNoiseImport`
      adds exactly: `Post.PinnedForAllAt` + `Post.PinnedForAllByHumanId` and the filtered index;
      `InjectItem.ExternalRef` and its filtered unique index; `Exercise.NoiseLevel` (required, default `'off'`);
      and the new `NoisePost` table with its index. Existing rows get `NoiseLevel = 'off'`.
- [ ] `NoisePost` implements `IExerciseScoped`, is registered in `PulseDbContext` with the **central exercise filter**,
      and has the lengths in the contract (`Text` 280, `PinnedForAllByHumanId` 128, `ExternalRef` 64, `NoiseLevel` 8).
- [ ] `ReactionKinds.Pin = "pin"` exists beside `Like` and `Repost`. **No behaviour change**: `ReactionService.TryParseKind`
      still rejects `pin` until story 04 (this story only adds the constant).
- [ ] `PostIngestService.AllowedOrigins` accepts `noise`. HTTP callers still cannot reach it (`PostAttributionResolver`
      is unchanged), proven by a test that a participant or controller `POST /api/posts` can never produce `Origin = "noise"`.
- [ ] **Given** `GET /api/chrome-config`, **then** the response carries `watermark: boolean` equal to the exercise's
      `WatermarkEnabled`. `enabled`, `top` and `bottom` are unchanged, including `ResolveEffectiveChromeEnabled`.
- [ ] The migration replays in `IdempotentMigrationScriptTests`. Any hand-written SQL that names a column added in this
      migration is `EXEC(N'…')`-wrapped (#413).

### Cross-cutting
- [ ] **Isolation (XC-001):** an isolation test proves a `NoisePost` from exercise A is invisible from exercise B
      through the central filter (extend the standing isolation suite).
- [ ] **Two worlds (XC-002):** `watermark` is the only new field on a participant-facing projection.

## Out of Scope

Every endpoint and behaviour that uses these columns (02–05). The participant client's use of `watermark` (06).

## Tests

Migration replay (`IdempotentMigrationScriptTests`), model snapshot shape, the isolation case, the `noise` origin guard,
and a `GET /api/chrome-config` projection test with `WatermarkEnabled` on and off.

Linked (all under `src/Pulse.WebApi.Tests`):

- AC 1 (one migration, exact schema, `off` backfill): `DemoFeedbackMigrationTests.TheMigration_IsTheFeaturesOnlyOne_DirectlyAfterEasyLogin`,
  `.TheModelSnapshot_MatchesTheModel_SoNoSchemaChangeIsPendingWithoutAMigration`, `.ThePostPinColumns_AreNullable_BoundedAndIndexedOnPinnedRowsOnly`,
  `.TheImportKey_IsBounded_AndUniquePerExerciseAmongLiveItems`, `.TheNoiseLevel_IsRequired_Bounded_AndDefaultsToOff`,
  `.Up_CreatesTheColumnsWithTheContractTypes_AndTheOffDefault`, `.Up_CreatesTheThreeIndexes_ScopeLeading_WithTheirFilters`,
  `.TheImportKey_RefusesASecondLiveItem_ButAllowsADeletedOne_AnotherExercise_AndNone`, `.TheNewColumns_RoundTrip_AndNewRowsTakeTheDefaults`,
  `.Down_RemovesTheSchema_AndUpReappliesIt`
- AC 2 (`NoisePost` scoped, lengths): `DemoFeedbackMigrationTests.NoisePost_HasTheContractColumns_NoForeignKey_AndTheLeastPostedFirstIndex`,
  `QueryFilterModelTests.EveryExerciseScopedEntity_HasAGlobalQueryFilter(NoisePost)`
- AC 3 (`ReactionKinds.Pin`, no behaviour change): `DemoFeedbackMigrationTests.ThePinReactionKind_IsTheConstantOnly_AndFitsTheKindColumn`,
  `ReactionServiceAuthorizationTests.ThePinKind_IsStillRejected_TheConstantAloneChangesNoBehaviour` (story 04 replaces it)
- AC 4 (`noise` origin, unreachable over HTTP): `PostIngestServiceAttributionTests.NoiseOrigin_FromAnInProcessCaller_IsAccepted_AndStoredAsNoise`,
  `PostWriteEndpointTests.ParticipantSession_ClaimingAPrivilegedOrigin_Returns403_AndPersistsNothing`,
  `PostWriteEndpointTests.StaffSession_ClaimingANonControllerOrigin_Returns400_AndPersistsNothing` (both now include `noise`)
- AC 5 (`watermark` on `GET /api/chrome-config`): `ChromeConfigProjectionTests.ProjectAsync_ServesWatermark_EqualToWatermarkEnabled_AndLeavesEnabledToTheGuard`,
  `.ConstantDefault_KeepsItsBanners_ButServesTheExercisesWatermark`,
  `ChromeConfigCompositionTests.ChromeConfig_ServesWatermark_EqualToTheExercisesWatermarkEnabled_WithEnabledUnchanged`,
  `.ChromeConfig_WithoutStory02Wired_StillServesTheExercisesWatermark`
- AC 6 (replay, `EXEC(N'…')`): `IdempotentMigrationScriptTests.TheDeployScript_BringsUpDemoFeedback_OverLegacyRows_AndReplaysAsANoOp`
- XC-001: `DemoFeedbackIsolationTests` (cross-exercise list, pacer read, IDOR, aggregate, fail-closed scope, write guard)
- XC-002: `ChromeConfigCompositionTests.ChromeConfig_KeepsTheFrozenWireShape_ExactlyFourKeysAndThreePerBanner`
