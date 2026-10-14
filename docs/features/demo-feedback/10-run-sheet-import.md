# Story: Run sheet: import from Excel, and the #493 form fix

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** inject queue (new: bulk load)  ·  **Decisions:** DF-9, DF-10, DF-11, DF-16  ·  **Issue:** _TBD_ (closes #493)
**Stack:** frontend  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** M

## Context

The console half of the MSEL import (03), plus the run-sheet form bug #493 (labels overlap their inputs). The import
is a two-step dialog: choose a file, see the dry-run report, then apply.

## Acceptance Criteria

- [ ] The run sheet toolbar gets **Import from Excel** after Add. It opens a COBRA dialog: a file picker accepting
      `.xlsx` and `.csv`, a one-line hint ("A Cadence MSEL export works as-is; only social-media rows are imported"),
      and **Preview**.
- [ ] Preview posts the file to `POST /api/injects/import?dryRun=true` and shows the counts (to create, update,
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
