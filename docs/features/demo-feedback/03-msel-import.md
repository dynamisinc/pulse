# Story: MSEL import into the run sheet (Cadence layout)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** inject queue (new: bulk load)  ·  **Decisions:** DF-9, DF-10, DF-11, DF-16  ·  **Issue:** #499
**Stack:** backend  ·  **Review:** Tier-1 (upload validation checked at Gate 1)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

"Posts must be easy to load from an Excel sheet. Other systems don't have an easy import." And: "Could this come
from our MSEL tool? Pulse could take the same file and ignore anything not meant for it." Cadence, our MSEL tool,
already exports an `.xlsx`/`.csv` in a fixed column layout. This story reads that file as-is, keeps the social-media
rows, and turns each into a single-post run-sheet item through the existing inject write path, with a dry run first.
Column mapping and limits are frozen in [`implementation.md` → MSEL columns](implementation.md#msel-columns-03-headers-matched-case-insensitively-trimmed-unknown-columns-ignored).

## Acceptance Criteria

- [ ] **Given** a controller session, **when** it posts a multipart `file` to `POST /api/injects/import?dryRun=true`,
      **then** it gets `200 InjectImportResultDto` and **nothing is written** (no item, no queue-version bump, no
      telemetry other than the dry-run event). With `dryRun=false` the same report comes back and the items are written.
      `dryRun` missing, repeated or not a bool ⇒ 400 (stricter than the roster import, which treats a missing flag as false; amended after Gate-1).
- [ ] **Upload validation:** empty file, file over 2 MiB, more than 2,000 data rows, a file that is neither `.xlsx`
      (checked by magic bytes `PK\x03\x04`, not by extension or MIME alone) nor UTF-8 text CSV, a workbook with no
      usable sheet, or a header row missing any of `Inject #`, `Delivery Method`, `From / Source`, `Description` ⇒ `400`
      with a readable reason and nothing written. The sheet named `MSEL` is used when present, else the first sheet.
      CSV: BOM tolerated, quoted cells with commas and line breaks, blank lines skipped.
- [ ] **Filter:** a row whose `Delivery Method` is social (DF-9 rule) is a candidate; every other row is reported
      `skipped` with "not a social-media inject (Delivery Method: X)". `socialRows` counts the candidates.
- [ ] **Mapping**, per candidate row: persona from `From / Source` (leading `@` stripped; handle, then exact display
      name, case-insensitive; **this exercise only**); text from `Description` run through `PostSanitizer`; title,
      notes, assignee, media and `PlannedMinute` per the contract (DF-11 for the minute). The result is one item with
      `kind = post` and one child post, created through `InjectItemValidator` and the `InjectQueueService` write path
      (so the queue version token and limits apply), appended after the existing items in file order.
- [ ] **Row failures** (status `failed`, nothing written for that row, the others still apply): unknown persona,
      empty or over-280 text after sanitising, unknown `Pulse Media` file name, more than 4 images or more than one
      video, any validator rejection (its message). An unknown `Responsible Controller` is a **warning**, not a failure
      (the item is unassigned). Two rows with the same `Inject #` ⇒ the later one fails ("duplicate of row N").
- [ ] **Idempotent re-import (DF-10):** `Inject #` is stored in `InjectItem.ExternalRef`. Importing the same file again
      reports every applied row `unchanged` and writes nothing. A changed row whose item is still `pending`/held (not
      fired, firing or skipped) is `updated` (version bumped, message says what changed); a changed row whose item has
      already fired is `unchanged` with "already fired; not changed". A deleted item's `ExternalRef` may be reused.
- [ ] All applied rows commit in **one** `SaveChanges` with the queue's existing concurrency handling; the run sheet's
      3-second poll shows them without any push.

### Cross-cutting
- [ ] **Isolation (XC-001):** items are stamped from `IExerciseContext`; personas, media and assignees resolve only
      inside the exercise. A handle that exists only in exercise B fails exactly like an unknown handle (same message).
- [ ] **Authorization:** behind `EngineCockpitStaffAuthorizationFilter` then `EngineCockpitControllerRoleFilter`
      (evaluator and planner ⇒ 403); request size limit = 2 MiB + 64 KiB; `DisableAntiforgery` as the roster import.
- [ ] **Content security (NFR-004):** every text cell is sanitised and length-bounded before it reaches the validator;
      no cell is ever evaluated as a formula (read cached values only).
- [ ] **Telemetry (XC-004):** one `injects.imported {created, updated, unchanged, skipped, failed, dryRun}` event.

## Out of Scope

The upload dialog (10). Bursts from a spreadsheet (DF-9). Writing conduct data back to Cadence. Any column not in the
contract (ignored).

## Tests

A real Cadence-layout fixture (`.xlsx` built with ClosedXML in the test, and the same as `.csv`) with social and
non-social rows; dry run writes nothing; apply creates items in order with the right minute, persona, notes and
assignee; re-import is all `unchanged`; changed pending row ⇒ `updated`; fired row ⇒ untouched; each failure reason;
magic-byte rejection of a renamed `.txt`; isolation A/B; role gate; telemetry.

All in `src/Pulse.WebApi.Tests/Features/Injects/Import/` (fixture: `MselFixture` writes Cadence's column layout,
`Inject #` as a number cell, and Cadence's own CSV escaping). DB tests are `[RequiresDockerFact]`.

- **AC-1 dry run / `dryRun` rule:** `InjectImportEndpointTests.DryRun_ReturnsTheReport_AndWritesNothingButTheDryRunEvent`,
  `.DryRunFalse_ReturnsTheSameReport_AndCreatesTheItems`, `.DryRunParameter_MissingRepeatedOrNotABool_Is400_AndNothingIsWritten`
- **AC-2 upload validation:** `InjectImportEndpointTests.UploadValidation_Refusals_Are400WithAReadableReason_AndWriteNothing`;
  `MselReaderTests.ARenamedTextFile_IsNotAWorkbook_MagicBytesDecide`, `.AWorkbookNamedCsv_IsStillReadAsAWorkbook`,
  `.BinaryOrNonUtf8Content_IsRefused`, `.AnEmptyFile_AndAnOversizedFile_AreRefused`, `.Xlsx_CadenceExport_ReadsTheMselSheet_WithTheNumericInjectNumberAsText`,
  `.Xlsx_WithoutAnMselSheet_UsesTheFirstSheet`, `.Xlsx_WithNoUsableSheet_IsRefused`, `.Xlsx_MoreThan2000DataRows_IsRefused`,
  `.Xlsx_AZipThatIsNotAWorkbook_IsRefusedAsUnreadable`, `.Xlsx_AMalformedZip_IsTheUnreadable400_NeverAnException`,
  `.Xlsx_AZipBomb_IsRefusedBeforeClosedXmlExpandsIt`,
  `.Csv_CadenceExport_ReadsHeaderAndRows_WithSpreadsheetRowNumbers_AndTheBomDropped`, `.Csv_QuotedCellsWithCommasLineBreaksAndQuotes_AreOneCell`,
  `.Csv_BlankLinesAndCommaOnlyLines_AreSkipped_ButStillCountTowardsRowNumbers`, `.Csv_AQuotedCellThatNeverCloses_IsRefused`,
  `.Csv_NoHeader_IsRefused`, `.Csv_MoreThan2000DataRows_IsRefused_And2000IsAccepted`;
  `MselImportPlannerTests.AHeaderMissingARequiredColumn_IsRefused_NamingWhatIsMissing`, `.HeadersMatch_CaseInsensitivelyAndTrimmed_UnknownColumnsIgnored`
- **AC-3 filter:** `MselImportPlannerTests.TheSocialRule_DF9`, `.NonSocialRows_AreSkippedWithTheReason_AndSocialRowsCounted`
- **AC-4 mapping (DF-11):** `InjectImportEndpointTests.Apply_AppendsOneSinglePostItemPerSocialRow_InFileOrder_AfterTheExistingItems`,
  `.Apply_TheCsvExport_ImportsExactlyLikeTheXlsx`; `MselImportPlannerTests.PlannedMinute_DF11_CountsFromTheEarliestScenarioDayAndTimeOfAnyRow`,
  `.PlannedMinute_FallsBackToScheduledTime_WhenNoRowHasAScenarioTime_AndIsNullWithNeither`, `.PlannedMinute_ARowWithoutTheChosenTime_IsUnplanned_AndAnUnreadableTimeWarns`,
  `.Mapping_PersonaByHandleWithTheAtStripped_ThenByExactDisplayName_CaseInsensitive`, `.Mapping_TitleNotesAssigneeTextAndExternalRef`,
  `.Mapping_ABlankTitleFallsBackToInjectNumber_ALongTitleAndNotesAreTruncatedWithAWarning`, `.Mapping_PulseMediaByFileName_NewestOfTwoSameNamedFilesWins_AltIsTheStem`,
  `.Mapping_OnlyAMatchedResponsibleController_ChangesAnExistingAssignee_ABlankCellKeepsIt`;
  `MselReaderTests.Xlsx_RealTimeCells_ReadAsTimesOfDay`
- **AC-5 row failures:** `InjectImportEndpointTests.RowFailures_AreReported_AndTheOtherRowsStillApply`;
  `MselImportPlannerTests.RowFailures_PersonaAndMedia`, `.RowFailures_EmptyOrOver280TextAfterSanitizing`,
  `.RowFailures_ADuplicateInjectNumber_FailsTheLaterRow`, `.RowFailures_ADuplicateTextInjectNumber_IgnoresCaseAndSurroundingSpace`,
  `.Mapping_AnUnknownResponsibleController_IsAWarningNotAFailure`
- **AC-6 idempotent re-import (DF-10):** `InjectImportEndpointTests.ReImportingTheSameFile_IsAllUnchanged_AndWritesNothing`,
  `.AChangedPendingRow_IsUpdated_WithTheVersionBumped_AndSaysWhatChanged`, `.AChangedRowWhoseItemAlreadyFired_IsLeftAlone`,
  `.ADeletedItemsInjectNumber_CanBeImportedAgain`, `.ReImport_ABlankResponsibleController_KeepsTheConsoleAssignment_AndTheFileStaysUnchanged`,
  `.TextInjectNumbers_MatchCaseInsensitively_ADuplicateFails_AndAReImportIsUnchangedNot409`
- **AC-7 one save + queue token:** `InjectImportEndpointTests.Apply_AppendsOneSinglePostItemPerSocialRow_InFileOrder_AfterTheExistingItems`
- **Isolation (XC-001):** `InjectImportEndpointTests.Isolation_PersonasAndMediaResolveOnlyInTheCallersExercise_AndItemsAreStampedFromScope`;
  `MselImportPlannerTests.Isolation_AHandleOnlyInAnotherExercise_FailsExactlyLikeAnUnknownHandle`
- **Authorization:** `InjectImportEndpointTests.OnlyAController_MayImport_EvaluatorAndPlannerAre403_AndAnUnassignedStaffIs403`
- **Content security (NFR-004):** `MselImportPlannerTests.Mapping_EveryTextCellIsSanitized_StripNeverEncode`;
  `MselReaderTests.Xlsx_NeverEvaluatesAFormula_ItReadsTheCachedValueOnly`, `.Csv_EveryCellIsLengthBounded`
- **Telemetry (XC-004):** `InjectImportEndpointTests.DryRun_ReturnsTheReport_AndWritesNothingButTheDryRunEvent`,
  `.Apply_AppendsOneSinglePostItemPerSocialRow_InFileOrder_AfterTheExistingItems`

## Tech notes

Own `Features/Injects/Import/**` (`InjectImportEndpoints.cs` with `AddInjectImport()` / `MapInjectImport()`,
`MselWorkbookReader.cs`, `MselCsvReader.cs`, `InjectImportService.cs`, DTOs). You may add the **minimum** to
`InjectQueueService.cs` / `InjectWriteRequests.cs` to carry `ExternalRef` through the existing create/update path
(nothing else changes there). **Read how `PlannedMinute` is interpreted** in `InjectQueueService` and the run sheet
before coding DF-11; if it is not "scenario minutes from StartEx", stop and tell the orchestrator.
