# Story: Run sheet: import from Excel, and the #493 form fix

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** inject queue (new: bulk load)  ·  **Decisions:** DF-9, DF-10, DF-11, DF-16  ·  **Issue:** #506 (closes #493)
**Stack:** frontend  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** M

## Context

The console half of the MSEL import (03), plus the run-sheet form bug #493 (labels overlap their inputs). The import
is a two-step dialog: choose a file, see the dry-run report, then apply.

## Acceptance Criteria

- [ ] The run sheet toolbar gets **Import from Excel** after Add. It opens a COBRA dialog: a file picker accepting
      `.xlsx` and `.csv`, a one-line hint ("A Cadence MSEL export works as-is; only social-media rows are imported"),
      and **Preview**.
- [ ] Preview posts the file to `POST /api/injects/import?dryRun=true` (always send `dryRun` explicitly; a missing flag is a 400) and shows the counts (to create, update,
      unchanged, skipped, failed) and a table of rows: row number, Inject #, title, persona, planned minute, status,
      message. Skipped rows are collapsed under "N rows skipped (not social media)"; failed rows are listed first.
- [ ] **Import N items** re-posts the same file with `dryRun=false`, shows the result counts, and closes on "Done". The
      run sheet shows the new items on its next poll (no extra wiring). 400 responses show the server's reason.
- [ ] #493: field labels in the "New scripted item" form no longer overlap their inputs and are readable. Labels sit
      **above** the input (not in the outlined notch) in a colour with at least 4.5:1 contrast against the panel; every
      `RunSheetField` use is fixed, not just the one in the report.
- [ ] Mock adapter for the import behind the run sheet's mock switch.

### Cross-cutting
- [ ] **Two worlds:** COBRA components only.
- [ ] **Accessibility:** the dialog traps focus, Escape closes it, the result table has headers.

## Out of Scope

Hiding Import for evaluators (11). Column mapping UI. Bursts from a spreadsheet.

## Tests

Preview → report rendering (failed first, skipped collapsed); apply; 400 reason; #493 label position and contrast
(computed style or a DOM-order assertion); dialog focus and Escape.

All in `src/frontend/src/features/controller/runSheet/` (Vitest + RTL, against the run sheet's mocks).

- **AC-1 toolbar + dialog:** `import/RunSheetImportDialog.test.tsx` › "puts Import from Excel right after Add",
  "opens a modal dialog with an .xlsx/.csv picker, the hint and Preview", "checks the file before upload"
- **AC-2 preview:** `import/RunSheetImportDialog.test.tsx` › "posts a dry run and shows the counts and the rows, failed
  first, skipped collapsed"; `import/importReport.test.ts` (ordering, counts, wording, client file check);
  `import/importService.test.ts` (`POST /injects/import`, multipart `file`, `dryRun` always explicit, fail-closed
  parse, no `exerciseId`)
- **AC-3 apply + 400:** `import/RunSheetImportDialog.test.tsx` › "re-posts the same file with dryRun=false, shows the
  result, Done closes, the sheet updates", "shows the server's reason on a 400…", "…when the import itself is
  refused…", "a 409 asks to run the import again"; `import/importService.test.ts` (400 → server `detail`;
  401 / 403 / 409 / 413 / other status each get their own kind and wording)
- **Snapshot at pick time (Gate-1 H-1, M-1):** `import/RunSheetImportDialog.test.tsx` › "posts a .csv picked as
  application/vnd.ms-excel as text/csv", "Import sends the previewed bytes even after the original file changes";
  `import/importReport.test.ts` › "the pick-time snapshot"
- **AC-4 #493:** `RunSheetField.test.tsx` (label is a `<label for>` before the input box, no notch; the label's
  computed colour is ≥ 4.5:1 on `panel`/`card`/`bg` at rest and in error; the focus tint is checked as the `blue`
  token, since jsdom does not evaluate `:focus-within`; every field of the "New scripted item" form)
- **AC-5 mock adapter:** `import/importMock.test.ts` (refusals, dry run writes nothing, apply creates items in the
  queue the poll reads, re-import never duplicates); `import/importService.test.ts` › `getInjectImportService`
- **A11y:** `import/RunSheetImportDialog.test.tsx` › "starts with focus inside the dialog, and the trap brings
  focus back" (focus behind the modal returns; the end sentinel wraps to the first control), "the hidden file input
  is not a tab stop of its own", "Escape closes the dialog", "Escape and Cancel are ignored while a request is in
  flight", "run-sheet shortcuts do not fire from inside the dialog", "modified keys (Ctrl/Cmd+K) still reach the
  console…", "secondary text clears 4.5:1 on white…", "the result table has a caption and column headers"
