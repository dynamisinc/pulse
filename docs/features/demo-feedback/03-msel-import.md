# Story: MSEL import into the run sheet (Cadence layout)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
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

## Tech notes

Own `Features/Injects/Import/**` (`InjectImportEndpoints.cs` with `AddInjectImport()` / `MapInjectImport()`,
`MselWorkbookReader.cs`, `MselCsvReader.cs`, `InjectImportService.cs`, DTOs). You may add the **minimum** to
`InjectQueueService.cs` / `InjectWriteRequests.cs` to carry `ExternalRef` through the existing create/update path
(nothing else changes there). **Read how `PlannedMinute` is interpreted** in `InjectQueueService` and the run sheet
before coding DF-11; if it is not "scenario minutes from StartEx", stop and tell the orchestrator.
