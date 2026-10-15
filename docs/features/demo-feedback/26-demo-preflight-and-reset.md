# Story: Demo pre-flight check and one-shot reset

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** demo plan §7 (reset/seed calendar), §10 (fragile UAT state)  ·  **Decisions:** DF-16 (amended), DF-28, DF-38  ·  **Issue:** #544
**Stack:** script  ·  **World:** ops  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** planning session · **Branch:** `build/demo-feedback/26-preflight-reset` → readiness PR to `main`

## Context

The pieces exist but the order lives in people's heads: `Reset-DemoState.ps1` (health, engine re-seed; `-Restart`
restarts the App Service and stops), `Clear-DemoContent.ps1` (archive old posts, veto stale drafts, archive imported
run-sheet items), `Seed-DemoContent.ps1` (pack, pins, noise pool, watermark, **pause tier engine**; `-RunSheet` defaults
to `all`, the demo needs `exceptMsel`), `Test-DemoFeedbackLive.ps1` (01-05 live checks). On 10/15 UAT sat at LIVE
(suggest) with ~37 drafts because the seed had not run after a reset. Rehearsal 1 (Sat), rehearsal 2 and the final
reset (Mon) and demo morning all need the same sequence and the same yes/no answer.

## Acceptance Criteria

### `Test-DemoReady.ps1` (read-only)

- [ ] Signs in as staff the way `Import-Roster.ps1` does (`Connect-StaffSession`, `PULSE_STAFF_SECRET` or the App
      Setting), signs out at the end, writes nothing. Prints PASS / WARN / FAIL per check and exits non-zero on any
      FAIL. `-Json` writes the results for the run-of-show log.
- [ ] Checks, each with the expected value in its message:
      1. API health and schema (migration `DemoFeedbackWave4RuntimeAndEdits` applied once 17 is deployed; WARN before).
         The first call also wakes serverless SQL (auto-pause after 60 min); report the wake time.
      2. Pause tier (`GET /api/steering/pause-tier`) is `engine` (FAIL on `running` or `injects`; FAIL on `freeze`:
         "never leave FROZEN").
      3. Engine review queue (`GET /api/engine/review-queue`) has 0 pending drafts (WARN 1-5, FAIL more).
      4. Generation provider is Fake (`GET /api/engine/settings`), DF-38.
      5. Noise level `off`; `WatermarkEnabled` on.
      6. Exercise pins p09 and p10 present (`GET /api/feed/pinned` as staff preview, or the staff read the seed uses).
      7. Run sheet: the expected seeded items pending, **no** MSEL-imported items (`ExternalRef` set) present, so the
         on-stage import shows its rows (DF-16).
      8. Media: one pack image and one pack video URL return 200 with the right content type (SAS reachable).
      9. Scenario clock reads a minute inside the pack's window (WARN otherwise).
      10. Wave 3/4 routes answer (not 404): `GET /api/feed/pinned`, `GET /api/posts/{a seeded id}/edits`.
- [ ] `-ExerciseId` / `-ApiHost` / `-SiteUrl` parameters with the same defaults as the other UAT scripts.

### `Invoke-DemoReset.ps1` (the one-shot)

- [ ] Runs, in order, stopping at the first failure with the failing step named:
      1. `POST /api/steering/runtime-state/reset` (story 18; until 18 is deployed, `Reset-DemoState.ps1 -Restart`, then
         the documented wait, polling health instead of a fixed 8 minutes);
      2. `Reset-DemoState.ps1` (engine loop re-seed);
      3. `Clear-DemoContent.ps1`;
      4. `Seed-DemoContent.ps1 -RunSheet exceptMsel` (which sets pause tier `engine`);
      5. `Test-DemoReady.ps1`.
- [ ] `-WhatIf` prints the plan and each script's own `-WhatIf` output without writing. A transcript goes to
      `scripts/uat/logs/demo-reset-<timestamp>.log` (git-ignored).
- [ ] It never passes a secret on the command line or into the log; Tom signs in where a sign-in is interactive.

### Docs

- [ ] `README-seed.md` gets a "Demo reset" section: when to run `Invoke-DemoReset` (Sat after the last merge, Mon after
      the last deploy, demo morning ≥ 1 h before), that an App Service restart **no longer** clears tier or clock
      after story 18 (DF-28), and the expected `Test-DemoReady` output.
- [ ] `Reset-DemoState.ps1 -Restart` help text says the same.

## Out of Scope

Any API change (18 owns the reset route). Load-test setup (post-demo-feedback/01).

## Technical Notes

Pester tests beside the scripts (`*.Tests.ps1`, same style as `Seed-DemoContent.Tests.ps1`), mocking
`Invoke-PulseApi` / `Invoke-RestMethod`. Scripts run on Tom's Windows box with PowerShell 7.

## Dependencies

18 deployed for step 1's route (with the fallback until then). Seed/Clear/Reset as on `main` (#519).

## Tests

`Test-DemoReady.Tests.ps1`: each check's PASS/WARN/FAIL with mocked responses; exit code; nothing written.
`Invoke-DemoReset.Tests.ps1`: order, stop on first failure, fallback when the reset route 404s, `-WhatIf` writes
nothing, no secret in the transcript. Manual: run both against UAT Saturday after the last merge.
