# Story: Participant-facing exercise name (#180 / #376)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started (ready as PR-4; also carries the A3 migration)
**Requirements:** COR-032, COR-053, SOC-001 (+ #180, #376)  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §8.4  ·  **Issue:** #376
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation, information leak)  ·  **Wave:** A3

## Context
The internal exercise name can leak the scenario (for example "HURREX-26 Cat 4 Landfall Dry Run"). Participants must only see a deliberate in-fiction name, with **no fallback** ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §8.4). Covers #376.

## Acceptance Criteria
- [ ] **Entity + settings (new):** `Exercise.ParticipantName` (`string?`, `HasMaxLength(80)`) is editable by the planner in the settings panel and round-trips through `ExerciseSettingsDto` (`participantName`) and `UpdateExerciseSettingsRequest`. Validated like `worldName` (`TryNormalizeOptionalText`, sanitized through `PostSanitizer`, 80-char bound = column width); blank normalizes to null. The PUT is **full-replace** like every other field (absent = cleared); the panel always sends the field. A wire-contract test asserts the panel's PUT body includes `participantName`.
- [ ] **Projection (new):** `ExerciseScopeDto.ExerciseName` becomes `string?` and projects `exercise.ParticipantName` only, **never falling back to `Name`**; null when unset. `ExerciseScopeDtoTests` and `ExerciseContextEndpointTests` updated.
- [ ] **Coordinated frozen-type change (null name):** frontend `ExerciseScope` and `ExerciseContextResponseBody` (`exerciseContextResolver.ts` lines 111/119) become `string | null`; `isValidResponseBody` (line 205) accepts `null` and still rejects `''` and non-string values; the mock body stays a non-null string. `exerciseContext.tsx:195` equality is null-safe. Brand-only rendering when null, no placeholder, no fallback. Clearance note posted by Session D on feature issue #42 when the PR opens (brief C1.4).
- [ ] **Participant consumers (new):** `JoinPage.tsx` (heading falls back to its generic heading, not the internal name), `ParticipantSignInPage.tsx` ("Sign in" without the name), the printed card (`RosterCardsDto.exerciseName`: server projection in `LinkCardService.cs:271` switches to the participant name, the `cardsService.ts:196` validator and `Card`/`CardSheet` accept null and omit the line), and the link email (`LinkEmailComposer.Subject` already falls back to "Your sign-in link" for empty; `LinkEmailService` passes the participant name or empty) use the participant name only; none can contain the internal `Name`.
- [ ] **Staff surfaces keep the internal name:** `ExerciseIdentityBadge.tsx` (149, 312) and `ExerciseLifecycleControl`/`EndExerciseDialog` currently read `scope.exerciseName` and must not go blank or show a participant name. Source the staff label from the staff assignment entry (`StaffAssignmentDto.exerciseName`, which stays `Exercise.Name`) with a neutral "Exercise" label if absent. (Open decision, see the currency check.)
- [ ] **Readiness (new):** blocking item `participant-name` in `ExerciseReadinessService.cs` (line ~262) flips from `NotChecked` to `Check(..., !string.IsNullOrWhiteSpace(exercise.ParticipantName), "No participant-facing name is set.")`; `ExerciseReadinessServiceTests` (lines 29, 57) and the frontend mock/test fixtures (`readinessService.ts:182`, `ReadinessPanel.test.tsx`, `readinessService.test.ts`) updated. The item links to the settings field.
- [ ] **A3 migration (new):** `20261019230000_A3SetupContentParticipantName` adds `Exercises.ParticipantName nvarchar(80) null`, `Posts.IsSetupContent bit not null default 0`, `Follows.IsSetupContent bit not null default 0`, with the backfills in the currency check (existing exercises: `ParticipantName = WorldName` truncated to 80, null when `WorldName` is null; never `Name`). Snapshot updated. The write-path stamp of `IsSetupContent` is story 01 (PR-5), not this PR.
- [ ] A projection test walks every participant DTO and email template asserting the internal `Name` never appears.
- [ ] Isolation (XC-001/002; brief C5): no new routes. The extended settings PUT keeps its foreign-exercise and foreign-org tests, and the scope/join/card projections are asserted not to leak across exercises.
- [ ] Telemetry (XC-004): the existing `exercise.settings.updated` event (same unit of work as the mutation) carries `participantName` in its changed-fields payload; nothing is added to the participant read path.
- [ ] Two worlds / scenario time: the name appears in the participant brand header in the exercise skin (no COBRA, no default MUI look); the settings field is COBRA.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; the field is keyboard-operable with a programmatic label, its length error is not color-only, and async save results are announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` and `participant-guide.md` updated in the same PR.

## Out of Scope
Per-persona display names; localisation.

## Technical Notes
Both worlds. Paths: `Exercise` entity, `ExerciseScopeDto`, settings panel (COBRA), participant brand header. Migration is A3's and ships in this PR (PR-4); see the currency check.

## Dependencies
Wave A3, after A1; can run with 07, 08. Readiness item consumed by 03.

## Tests
Resolver test: a response body with `exerciseName: null` resolves (and `''`/numeric is rejected); type-check across all `exerciseName` consumers; projection leak test; readiness test; RTL for header with and without name; foreign-exercise/org tests.

**Backend (PR-4):**
- Entity + settings: `ExerciseSettingsEndpointsTests.Put_PersistsEverySettingNamedInCor030_AndSurvivesAReload`, `.Put_OmittedOptionalFields_ClearThemBackToNotConfigured` (full replace), `.Put_OverLengthParticipantName_Returns400_AndEightyCharactersIsAccepted`, `.Put_ParticipantName_IsTrimmedSanitizedAndBlankClearsIt`; `ExerciseSettingsFieldRulesTests.TryNormalizeParticipantName_TrimsSanitizesAndBlankIsNull`, `.TryNormalizeParticipantName_BoundsAtEightyCharacters_AndRejectsAllMarkup`, `.UpdateExerciseSettingsRequest_DeserializesTheDocumentedWireBody`, `.ExerciseSettingsDto_SerializesTheDocumentedCamelCaseWireKeys`.
- Projection without fallback: `ExerciseScopeDtoTests.FromExercise_MapsEveryFieldCorrectly`, `.ExerciseName_IsNull_WhenNoParticipantNameIsSet_AndNeverFallsBackToTheInternalName`, `.ExerciseName_IsNullWhenBlankOrWhitespace_AndTrimmedOtherwise`; `ExerciseContextEndpointTests.ResolvedHost_Returns200_WithTheSeededExercisesScope_NeverAnotherExercisesData`, `.ResolvedHost_WithNoParticipantName_ReturnsANullExerciseName_NeverTheInternalName`.
- Participant consumers (cards, link email): `LinkCardServiceTests.EligibleParticipants_GetACardEach_WithEveryField_OrderedByName`, `.TheSheetsExerciseName_IsNullWhenBlankOrWhitespace_AndTrimmedOtherwise`, `LinkCardEndpointsHttpTests.AController_Gets200_InTheFrozenShape_WithNoStore`, `EasyLoginDtoContractTests.RosterCardsDto_WritesANullExerciseName_RatherThanOmittingIt`, `LinkEmailServiceTests.EachEligibleParticipant_GetsOneMessage_WithTheirOwnLink_AndEveryoneElseIsSkippedWithTheReason`, `ExerciseFactsReaderTests.GetAsync_ReturnsNameZoneStatusTenantAndStoredScenarioTime`.
- Readiness: `ExerciseReadinessServiceTests.ParticipantName_IsOk_WhenAParticipantFacingNameIsSet`, `.ParticipantName_IsOpenAndBlocks_WhenNoParticipantFacingNameIsSet`, `.Readiness_NeverCountsAnotherExercisesRows`; `ReadinessRoleTests.Readiness_ServesTheContractShape_ForTheSessionsOwnExercise`.
- A3 migration: `A3SetupContentParticipantNameMigrationTests` (one test per backfill branch, Down, replay; `.Up_BackfillsParticipantName_BlankOrWhitespaceWorldNameIsNull_AndTheValueIsTrimmedWithinEighty`); `IdempotentMigrationScriptTests.TheDeployScript_BringsUpA3_OverExistingPostsFollowsAndExercises_AndReplaysAsANoOp`.
- Projection leak test: `ParticipantFacingNameLeakTests.TheInternalName_AppearsInNoParticipantReadResponse`, `.ThePrintedCardSheet_CarriesOnlyTheParticipantName`, `.ThePersonalLinkEmail_CarriesOnlyTheParticipantName`, `.EveryEmailTemplate_IsCoveredByThisLeakSuite`.
- Isolation: `ExerciseSettingsEndpointsTests.Put_InExerciseA_NeverTouchesExerciseB_EvenWhenTheBodyNamesIt`, `.Get_InExerciseA_NeverReturnsExerciseBsSettings`; `LinkCardIsolationTests.TheExerciseName_IsTheCallersExercise`; `LinkEmailIsolationTests.TheExerciseNameInTheSubject_IsTheCallersExercise`.
- Telemetry: `ExerciseSettingsEndpointsTests.Put_EmitsExactlyOneSettingsUpdatedTelemetryEvent_ListingTheChangedFields` (changed-fields payload carries `ParticipantName`, never its value).

### Copilot review 3 fold (2026-10-16)
- Changed: null `exerciseName` is a frozen-contract change (DTO `string?`, frontend type, resolver validator) with a coordinated-change AC, null-name resolver test and clearance note; all consumers render brand-only when null.

## Deploy order

This story ships as three PRs. PR-4a (`feature/build-09a-null-name-tolerance`, frontend null-tolerance only) is #669, merged and deployed to UAT first (verify its Deploy Frontend run is green). PR-4b (#670, `feature/build-a3-setup-content`: the A3 migration, the backend projection and the settings field) is **order-independent**: the frontend tolerates an old backend (an absent `participantName` reads as null) and the post-#669 bundle tolerates the new backend's null name, so there is no cancel and re-dispatch. PR-4c (the NavRail name, and the participant-guide sentence about it) merges **only after #670's Deploy Backend run is green**, including its `/api/build` commit check and `/api/exercise-context` smoke, because against an old backend the scope name is the internal name (#376). Rollback is a revert PR (no workflow runs a `Down`; the columns are additive). The full procedure (re-scaffolding the migration after #655 and #665, reloading staff consoles, backfill cost) is in [`docs/OPERATE.md` → A3](../../OPERATE.md#a3--participant-facing-name--setup-content-columns-exercise-build-golive09-670).

## Currency check 2026-10-19 (Session D, PR-4)

Tom's decisions: (a) the A3 migration ships in PR-4; (b) existing exercises backfill `ParticipantName = WorldName` (null if null), never `Name`; (c) Session D posts the frozen-type clearance on #42 at PR open; (d) readiness `participant-name` becomes a real blocking check here. **Migration window:** the PR is held until Tom opens the UAT window; regenerate the migration against main after #655 (`20261019171234`) and #665 (`20261019200000`) merge, so `20261019230000` sorts last. Latest migration on this branch is `20261017120000`.

**Consumers of `ExerciseScopeDto.exerciseName` / `ExerciseScope.exerciseName` (main + readiness):**
- Backend: `Features/ExerciseResolution/ExerciseScopeDto.cs:41,67` (today `exercise.Name`, required string).
- Resolver/provider: `core/exerciseContext/exerciseContextResolver.ts` (111, 119, 132 mock, 205, 231), `core/exerciseContext/exerciseContext.tsx:195`.
- Participant: `features/login/pages/JoinPage.tsx:217-304` (`?? GENERIC_HEADING`, already null-tolerant), `features/login/pages/ParticipantSignInPage.tsx:243-431` (already null-tolerant). No participant brand header or shell reads `exerciseName` today (the header uses `brandName` via `ParticipantShellConfigService`), so a header showing the name is net-new rendering.
- Staff (must NOT go null): `features/staffShell/components/ExerciseIdentityBadge.tsx:149,312`; `features/controller/lifecycle/ExerciseLifecycleControl.tsx:128,285` -> `EndExerciseDialog.tsx:93-168`.
- Separate DTOs with their own `exerciseName` that stay on `Name` (staff-only, not the frozen scope): `StaffAssignmentDto`, `ExerciseAdminDtos.cs:120`, `ExerciseSwitcher.tsx`, `staffAssignmentsService.ts`.
- Participant-facing via `ExerciseFactsReader.Name` (`Features/Identity/EasyLogin/ExerciseFactsReader.cs:58`): `LinkCardService.cs:271` -> `RosterCardsDto.exerciseName` (`EasyLoginDtos.cs:419`; frontend `cardsService.ts:196,245,290`, `cards/types.ts:63`, `Card.tsx`, `CardSheet.tsx`, `CardSheetPreview.tsx:313`); `LinkEmailService.cs:439-447` -> `LinkEmailComposer.Subject` (`LinkEmailComposer.cs:81`). `AcsParticipantLinkMailer.cs` renders no exercise name (it only sends). Staff-only readers of the same facts (exports filename, report) keep `Name`; add a separate `ParticipantName` to `ExerciseFacts` rather than changing `Name`.
- Not on main: invite and reset templates (A2, PR #665). Whichever lands later must use `ParticipantName`; the projection test should enumerate templates by directory so it catches them.

**Resolver validator:** `isValidResponseBody` (`exerciseContextResolver.ts:~205`) requires `exerciseId`, `exerciseName`, `timeZone` each a non-empty string, and `isExerciseStatus(status)`. Change only the `exerciseName` clause to accept `null` or a non-empty string. Tests: `exerciseContextResolver.test.ts` and `.default.test.ts`.

**Settings PUT rule chosen:** the existing pattern is full replace with every field `string?` and absent = null = cleared (`ExerciseSettingsService.Apply`, `TryValidate` in wire order). `ParticipantName` follows it exactly, placed after `WorldName` (DTO, request, `ValidatedExerciseSettings`, `Apply`, `ExerciseSettingsFieldRules.MaxParticipantNameLength = 80`). No absent-means-unchanged exception is invented: old clients omitting it would wipe it, so the panel (`ExerciseSettingsPanel.tsx`, `exerciseSettingsService.ts` 122/159/241/359) ships in the same PR and always sends it, and the readiness block catches a wipe before staging. `WorldName` (200, in-fiction place name) is a different field; do not conflate.

**IsSetupContent backfill (exact rule; columns confirmed):** `Post.CreatedWallClock`, `Post.Origin`, `Follow.CreatedWallClock`, `Exercise.Status`, `TelemetryEvents.EventType/WallClockTime/Payload` all exist. Payload is `LifecycleTransitionPayload {from, to, storedStatusBefore}` (`ExerciseLifecycleService.cs:490`). Reuse the `AdminIdentityFoundation` idiom `CASE WHEN ISJSON(t.[Payload]) = 1 THEN JSON_VALUE(t.[Payload], '$.from') END`. Let `leftBuildAt(e)` = `MIN(t.WallClockTime)` over `t.ExerciseId = e.Id AND t.EventType = 'exercise.lifecycle.transitioned' AND JSON_VALUE(Payload, '$.from') = 'build'`.
- Posts: `IsSetupContent = 1` when `p.Origin <> 'participant'` AND (`e.Status = 'build'` OR (`leftBuildAt IS NOT NULL` AND `p.CreatedWallClock < leftBuildAt`)); else 0 (no event = conduct, fail safe).
- Follows: same, without the Origin test.
- Open point: Decision 5.4 says "every row is setup" for a build exercise, and separately that participant-origin posts are always conduct; this story applies the participant exclusion in both cases. Confirm with Tom.
- Check what `from` legacy rows hold (`storedStatusBefore` carries the raw value; also accept `'scheduled'` there if legacy used it). Migration test over a seeded SQL fixture for each branch.
- `ParticipantName` backfill: `UPDATE Exercises SET ParticipantName = LEFT(WorldName, 80) WHERE WorldName IS NOT NULL`.

**AC status:**

| Item | State |
|---|---|
| Entity field, settings editing, 80-char bound | Remain (new) |
| `ExerciseScopeDto` projection without fallback | Remain; "same field name" wording replaced |
| Frozen-type null change (DTO, type, validator) | Remain; line numbers verified |
| Cards, emails, join page | Remain; join/sign-in already null-tolerant; "invite/reset emails" struck to "link email" (invite/reset are A2, not on main) |
| Staff surfaces keep internal name | New (gap in original) |
| Readiness item "2" | Stale numbering; it is `participant-name`, currently `NotChecked`; remains |
| A3 migration | New (was a note only) |
| Projection leak test, isolation, telemetry, a11y, guide | Kept (isolation scoped to no new routes; telemetry reuses `exercise.settings.updated`) |
| Already met | None |
