# Story: Post activity export (.xlsx)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** AAR export (lite; E10 F10.4 slice)  ·  **Decisions:** DF-8  ·  **Issue:** #498
**Stack:** backend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

Both note sets ask for an end-of-exercise report exportable to Excel, filterable by player posts versus controller
posts. This story is the server half: one download of every post and reply in the exercise, one row each, with an
**Author type** column the evaluator can filter in Excel. The console button is story 09. It uses ClosedXML
0.105.1, added to `Pulse.WebApi.csproj` by orchestrator seam S-1.

## Acceptance Criteria

- [ ] **Given** an assigned staff session (controller, evaluator or planner), **when** it calls
      `GET /api/staff/exports/posts.xlsx`, **then** it gets `200` with content type
      `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment;
      filename="pulse-posts-<exercise-slug>-<yyyyMMdd-HHmm>.xlsx"`, and `Cache-Control: no-store`.
      No session ⇒ 401; a participant or view-only session, or staff not assigned to the exercise ⇒ 403 (or the
      existing filter's code).
- [ ] The workbook has one sheet, `Posts`, with the columns **in the order** listed in
      [`implementation.md` → Export columns](implementation.md#export-columns-02-sheet-posts), a bold frozen header row,
      an **autofilter** over the used range, and sensible column widths (`Text` wrapped, about 60 wide).
- [ ] One row per post in the exercise, **including replies and taken-down posts**, oldest first by scenario time
      (ties by wall clock). `Author type` maps `Origin`: `participant` → Participant, `controller-as-persona` →
      Controller as persona, `inject` → Scripted inject, `engine` → Engine, `noise` → White noise. An unknown origin
      writes the raw value (never throws).
- [ ] `Posted by` is the acting human's display name (staff user or participant account) resolved inside the exercise;
      blank for engine and white noise. `Inject #` is the inject item's `ExternalRef`, else its title, for posts with
      an `InjectId`; blank otherwise.
- [ ] `Likes`/`Reposts`/`Replies` are the real counts (`pin` reactions never counted); the `Shown …` columns are
      baseline + real, matching what participants saw. `Pinned for all` is `Yes` when `PinnedForAllAt` is set
      (blank until story 04 sets any). `Status` is `Live` or `Taken down`, with `Taken down at` in scenario time.
- [ ] Times: `Scenario time` and `Taken down at` in the exercise's scenario time as `yyyy-MM-dd HH:mm`;
      `Wall clock (UTC)` as an Excel date-time cell.
- [ ] **Formula safety:** every text cell is written as a value (never `FormulaA1`/`FormulaR1C1`). A post whose text
      starts with `=`, `+`, `-` or `@` opens in Excel as that literal text (test reads the cell back and asserts it
      has no formula).
- [ ] Up to 50,000 rows: paged reads, buffered build (the post table is never loaded into memory at once; the
      workbook is built in one buffer and sent from it). Above that, `413` with a readable reason. One export runs at
      a time per process; a second one while it runs gets `429` with a readable reason.

### Cross-cutting
- [ ] **Isolation (XC-001):** every read goes through `IExerciseContext` and the central filter. An export from
      exercise A contains no row, persona, staff name or inject from exercise B (test with seeded A and B).
- [ ] **Telemetry (XC-004):** one `export.posts.downloaded {rows}` event per download, staff actor, no text.
- [ ] **Two worlds:** the route is under `/api/staff/` and never reachable by a participant session.

## Out of Scope

The console button (09). Per-inject implementer sheets, charts, a second sheet, CSV. Scheduled or emailed exports.

## Tests

Gate tests (401/403 per role, evaluator allowed), column order and header, author-type mapping per origin, a reply row,
a taken-down row, formula-safety read-back, isolation A/B, telemetry, and the content headers. Read the generated
bytes back with ClosedXML in the test.

Linked (`src/Pulse.WebApi.Tests/Features/Exports/`):

- AC 1 (gate, headers): `PostExportEndpointTests.Anonymous_Returns401_WithNoStore`, `ParticipantSession_Returns401_ItIsNotAStaffSession`,
  `ReadOnlySession_Returns401_ItIsNotAStaffSession`, `StaffNotAssignedToTheExercise_Returns403`, `UnresolvedScope_Returns401`,
  `AnyAssignedStaffRole_Gets200_WithTheXlsxHeaders` (controller, evaluator, planner), `Route_IsInTheStaffWorld`
- AC 2 (sheet layout): `PostExportWorkbookTests.Sheet_IsPosts_WithTheFrozenColumnsInOrder_BoldFrozenHeader_AndAutofilterOverTheUsedRange`,
  `Columns_HaveSensibleWidths_AndTextIsWrappedAboutSixtyWide`, `AnEmptyExport_StillHasTheHeaderAndAFilter`
- AC 3-5 (rows, author type, posted by, inject #, counts, pinned, status): `PostExportEndpointTests.EveryPostAndReply_IncludingTakenDown_OneRowEach_OldestFirst_WithResolvedColumns`,
  `PostExportWorkbookTests.AuthorType_MapsEveryOrigin_AndWritesAnUnknownOneRaw`, `PostedBy_IsBlankOnlyForEngineAndWhiteNoise`,
  `Media_IsSummarisedReadably`, `ReplyTo_IsHandleAndPostId_OrTheIdAlone_OrBlank`
- AC 6 (times): `PostExportWorkbookTests.WallClock_IsAnExcelDateTimeCell_AndCountsAreNumbers`, `ScenarioTime_IsFormattedInTheExercisesZone`,
  `FileName_UsesTheExerciseSlug_AndTheUtcMinute`
- AC 7 (formula safety): `PostExportWorkbookTests.FormulaLookingText_IsWrittenAsLiteralText_NeverAFormula`, `CleanText_DropsCharactersXmlCannotCarry_AndKeepsEverythingElse`
- AC 8 (paged reads, buffered build, 413, 429): `PostExportEndpointTests.MoreThanOnePage_IsWrittenCompletelyInTheExactOrder_AcrossThePageBoundary`,
  `MoreThanFiftyThousandPosts_Returns413_WithAReadableReason_AndNoTelemetry`, `ASecondExportWhileOneIsRunning_Returns429_WithAReadableReason`,
  `ARefusedCaller_NeverTakesTheGate`, `PostExportWorkbookTests.Gate_AdmitsOneExportAtATime_AndALeaseReleasesOnlyOnce`
- Isolation: `PostExportEndpointTests.ExportFromA_ContainsNoRowPersonaStaffNameOrInjectFromB`
- Telemetry: `PostExportEndpointTests.OneDownloadedEvent_PerDownload_StaffActor_RowsOnly`

## Tech notes

Own `Features/Exports/**`: `PostExportEndpoints.cs` (`AddPostExport()` / `MapPostExport()`; the orchestrator wires
them into `Program.cs`, seam S-2), `PostExportService.cs`, `PostExportRow.cs`. Use the gate composition from
`ModerationEndpoints.cs:79-87` (staff filter only, no controller filter) plus `NoStoreEndpointFilter`.
