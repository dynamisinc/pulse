# Story: Seed script: noise pool, exercise pins, watermark on

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Decisions:** DF-12, DF-16  ·  **Issue:** #510
**Stack:** script  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 3  ·  **Effort:** M

## Context

`scripts/uat/Seed-DemoContent.ps1` loads the demo pack through the public APIs. It needs to load the new content
(noise pool, exercise pins), make sure media marking is on, and skip the run-sheet items that the on-stage MSEL import
will add (DF-16).

## Acceptance Criteria

- [x] `pack.schema.json` gains optional `noise: [{ persona, text }]` and `pins: [postKey]` (and a run-sheet item `msel`);
      the test fixture pack gains a few of each; existing packs stay valid.
- [x] The script loads `noise` with `PUT /api/staff/noise/pool { mode: 'replace' }` and reports `rejected` entries as
      warnings; it sets `PUT /api/staff/noise { level: 'off' }` at the end of every run.
- [x] It pins each `pins` post for everyone with `PUT /api/staff/posts/{id}/pin`.
- [x] It ensures `watermarkEnabled = true` through `PUT /api/staff/chrome-settings` (read first, change only that field).
- [x] A new `-RunSheet all|exceptMsel|none` switch (default `all`): `exceptMsel` loads every item without an `msel` ref
      (the demo setting, DF-16); the on-stage MSEL import adds the rest.
- [x] Re-running is safe (the same idempotency rules the script already follows); `Seed-DemoContent.Tests.ps1` covers
      the new steps; `README-seed.md` documents them and the demo command line.

**Amendment (orchestrator, 10/15):** `bursts` became `exceptMsel` (+ item `msel`): a burst's reply parents cannot travel by MSEL.

## Out of Scope

Authoring the content (C).

## Tests

Pester tests for the new steps against the mock API seam the script already uses.
