# Story: Word (.docx) export of the exercise report, with white-labeling

**Feature:** AAR export package  ·  **Epic:** E10  ·  **Phase:** 4 (post-demo)  ·  **Status:** Not Started · backlog
**Requirements:** EVL-030 (adjacent), COR-053, NFR-001  ·  **Design decisions:** none  ·  **Issue:** #555

## Context
The printable exercise report ([demo-feedback 29](../demo-feedback/29-printable-exercise-report.md)) ships for the
10/20 demo as a browser page saved to PDF. At the 10/15 demo a Word or PDF was asked for, and white-labeling was named
as the next step. Clients editing an after-action report want a Word file they can work in, and client branding (logo,
cover page, colors) fits Word naturally, so the two are built together.

Staff world (XC-002): the document carries provenance (origin, posted by, inject #). A `.docx` is editable, so it is
labeled a draft. It is not an evidentiary record; the PDF and the `.xlsx` remain the record.

Estimated effort: about 2 to 3 days (assessed 10/15).

## Acceptance Criteria
- [ ] `GET /api/staff/exports/report.docx?includeNoise=` returns a Word document with the same sections, order and
      content as the printable report: EXERCISE marking, header, At a glance with the source split, activity over time,
      inject response times and method note, verified vs. lookalike (omitted when there are no pairs), and the post
      record grouped by scenario half-hour. White noise is left out of the list unless requested (DF-41).
- [ ] It is built from the existing report data (`ExerciseReportService`), so the page, PDF and `.docx` never disagree.
      No second query path.
- [ ] Images and video posters are embedded (not linked) at a fixed width, each followed by its alt text under an
      "ALT TEXT" label and set as the picture's description (NFR-001). A missing or unreadable file prints a plain tile
      with the alt text, and the export does not fail.
- [ ] Charts are drawn as native Word tables (shaded cells for bars, with numbers in text), never color-only. No
      native image-rendering dependency.
- [ ] US Letter, an "EXERCISE" header band on every page, page numbers in the footer ("Page N of M"), posts kept from
      splitting across pages (keep-with-next / cantSplit), and every time in scenario time (COR-053).
- [ ] White-labeling: an organization can set a logo, a display name and an accent color, applied to a cover page and
      the header. Without settings the document uses a neutral default, never the COBRA staff look and never a
      participant brand skin.
- [ ] The document is marked "Draft: generated from Pulse, editable" in its properties and on the cover page.
- [ ] An "Export Word" action sits beside Print / Save as PDF on the report page (screen only).
- [ ] Size guard: total embedded media is capped (for example 50 MB). Above the cap, the export returns 413 with a
      readable reason, or downscales the images. Decide before build.
- [ ] Isolation (XC-001/COR-001): every media read goes through the exercise-scoped `MediaAssets`, so an asset from
      another exercise cannot be embedded. An unresolved scope returns 401 before any read.
- [ ] Telemetry (XC-004): one `export.report.docx.downloaded` event per document, payload `{ posts }` only.
- [ ] Content security (NFR-004): post text and alt text are written as text runs, never as fields or markup.

## Out of Scope
Editing or round-tripping a `.docx` back into Pulse; HSEEP AAR/IP template structure (its own story); server-side PDF;
controller notes ([03](03-controller-notes.md), which this document includes once it exists); per-participant scoring.

## Technical Notes
- **Library:** `DocumentFormat.OpenXml` (Open XML SDK, MIT) is already in the dependency tree through ClosedXML.
  Reference it directly at the version ClosedXML resolves, so there is no second copy.
- **Media read:** `IMediaStore` has `SaveAsync` and `DeleteAsync` but no read. Add
  `OpenReadAsync(blobName, CancellationToken)` to `AzureBlobMediaStore`, `LocalFileMediaStore` and the unconfigured
  fallback, with their tests.
- **Builder:** keep it pure, e.g. `ExerciseReportDocxBuilder` taking the report DTO plus a media-bytes lookup, so it can
  be unit-tested by opening the produced package and asserting on its structure.
- **Branding settings:** decide whether white-label settings live on the organization or on the exercise
  (organization-level is the likely default, with an exercise override later).
- **Maintenance:** this is a second layout to keep in step with the print page. Any report change touches both; note
  it in the report feature's README.

## Dependencies
demo-feedback 29 (report data and page). A decision on where white-label settings are stored. Controller notes (03)
is optional and is included when present.

## Tests
- Builder unit tests: every section is present, alt text appears on every picture, a missing image gives a tile, the
  lookalike section is omitted when empty, and there are no color-only bars.
- Media read tests for each store.
- Endpoint tests: 401 for an unresolved scope, cross-exercise media never embedded, the size guard, and the
  telemetry payload.
- Manual: open the file in Word and in LibreOffice and check page breaks and branding.
