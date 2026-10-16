# Story: Demo pre-flight check and one-shot reset

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
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

- [x] Signs in as staff the way `Import-Roster.ps1` does (`Connect-StaffSession`, `PULSE_STAFF_SECRET` or the App
      Setting), signs out at the end, writes nothing. Prints PASS / WARN / FAIL per check and exits non-zero on any
      FAIL. `-Json` writes the results for the run-of-show log.
- [x] Checks, each with the expected value in its message:
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
- [x] `-ExerciseId` / `-ApiHost` / `-SiteUrl` parameters with the same defaults as the other UAT scripts.

### `Invoke-DemoReset.ps1` (the one-shot)

- [x] Runs, in order, stopping at the first failure with the failing step named:
      1. `POST /api/steering/runtime-state/reset` (story 18; until 18 is deployed, `Reset-DemoState.ps1 -Restart`, then
         the documented wait, polling health instead of a fixed 8 minutes);
      2. `Reset-DemoState.ps1` (engine loop re-seed);
      3. `Clear-DemoContent.ps1`;
      4. `Seed-DemoContent.ps1 -RunSheet exceptMsel` (which sets pause tier `engine`);
      5. `Test-DemoReady.ps1`.
- [x] `-WhatIf` prints the plan and each script's own `-WhatIf` output without writing. A transcript goes to
      `scripts/uat/logs/demo-reset-<timestamp>.log` (git-ignored).
- [x] It never passes a secret on the command line or into the log; Tom signs in where a sign-in is interactive.

### Docs

- [x] `README-seed.md` gets a "Demo reset" section: when to run `Invoke-DemoReset` (Sat after the last merge, Mon after
      the last deploy, demo morning ≥ 1 h before), that an App Service restart **no longer** clears tier or clock
      after story 18 (DF-28), and the expected `Test-DemoReady` output.
- [x] `Reset-DemoState.ps1 -Restart` help text says the same.

### Build notes (what the API cannot show)

- Check 1: no route lists applied migrations, so `DemoFeedbackWave4RuntimeAndEdits` is read from story 17's contract:
  `GET /api/steering/pause-tier` carries `persisted` once 17 is deployed (WARN before; `persisted = false` is a WARN).
- Check 7: `GET /api/injects` does not expose `ExternalRef`. Items are told apart by title against the pack: a pending
  or held item that is not a seeded pack item FAILS (an MSEL import, a seeded copy of an msel item, or a console item);
  a spent one WARNS (if imported, `Clear-DemoContent.ps1` archives it).
- Check 9: no route reads the server's scenario clock, and the participant clock is the browser's wall clock. The check
  reads the seed's anchor from the feed (a pack post's `scenarioTime` + `minutesBeforeAnchor`) and WARNS outside 0-720
  minutes after it (Trending's 12 h) or when `clockFrozen` is true; the message says the server clock is not readable.
- Check 10: `GET /api/posts/{id}/edits` 404 is a WARN until story 19 deploys.
- Step 1 fallback: before the restart the old process is marked (pause tier `engine` if it read `running`), then the
  script polls `/health` + `GET /api/steering/pause-tier` until two consecutive `running` reads (only the new process
  can answer that) instead of a fixed 8 minutes. `-WhatIf` uses `Reset-DemoState.ps1 -CheckOnly` (it has no `-WhatIf`)
  and does not run `Test-DemoReady.ps1`.
- Pass-through switches: `-AutoConfirmResponses` (step 2), `-ReloadFiredRunSheet` (step 4).

## Out of Scope

Any API change (18 owns the reset route). Load-test setup (post-demo-feedback/01).

## Technical Notes

Pester tests beside the scripts (`*.Tests.ps1`, same style as `Seed-DemoContent.Tests.ps1`), mocking
`Invoke-PulseApi` / `Invoke-RestMethod`. Scripts run on Tom's Windows box with PowerShell 7.

## Dependencies

18 deployed for step 1's route (with the fallback until then). Seed/Clear/Reset as on `main` (#519).

## Tests

`Test-DemoReady.Tests.ps1` (72 tests, Pester 5, no network): a ready exercise passes all ten checks and is read-only
(only GETs besides sign-in/sign-out; sign-out also after a throw); sign-in body and `-ExerciseId`; check 1 health
down / slow wake / schema 5xx / Wave 4 `persisted` true, absent, false; check 2 engine, running, injects, freeze;
check 3 0 / 1 / 5 / 6 drafts; check 4 Fake, AzureOpenAI, cut to Fake; check 5 noise and watermark; check 6 missing
pin, personal pin; check 7 seeded item fired / missing, unknown pending item, armable msel copy, unknown spent item
(WARN), spent earlier copies; check 8 ranged GET without the token, 403, wrong content type, no video; check 9 inside
the window, 13 h old (WARN), frozen (WARN); check 10 edits 404 (WARN), seeded post id, pinned 404 (FAIL); the real
script's exit code (1 on FAIL, 0 on WARN only); `-Json` contents and nothing written without it; no secret, token or
SAS link in any stream (with `-Verbose -Debug`), the JSON file or `$Error`.

`Invoke-DemoReset.Tests.ps1` (50 tests): order (reset route, Reset-DemoState, Clear, Seed `-RunSheet exceptMsel`,
Test-DemoReady) and each step's arguments; sign-out before step 2; stop on first failure at steps 2-5 (exit and
throw), and at step 1 on 403/500, naming the step and the steps not run; fallback on 404: marker then `-Restart` then
polling (no fixed wait), no marker when already off running, two consecutive `running` reads, `-Restart` exit not 3,
timeout, refused marker; `-WhatIf` sends no request, uses each script's preview and skips the pre-flight, and keeps
going past a failed preview; transcript file name and contents; no secret or token in any argument, transcript or
stream (live, fallback, `-WhatIf`); `.gitignore` lists `scripts/uat/logs/`; `Reset-DemoState -Restart` help (DF-28);
the real `Invoke-DemoScript` seam returns a child's exit code.

Gate-1 folds: M-1 a failure after step 1 sets pause tier `engine` (best effort) and prints the tier in red, or "pause
the engine from the console"; none after a step 1 failure or under `-WhatIf`. M-2 step 1 polls `/health` then
`/health/ready` first (slow wake goes on; never waking fails before any sign-in). L-1 a pinned read with no answer is a
check 10 FAIL. L-2 a review queue that is not a JSON array is FAIL "unexpected shape". L-3/L-4 help notes (one-instance
assumption; 17-without-18 keeps the marker, also in the timeout message). L-5 anchor printed in UTC. L-6 duplicate
pending copies of a seeded item WARN; check 8 prefers a pack media item (file name or alt), falls back to any.

PR #548 review (Copilot): after step 1, white noise goes off (`PUT /api/staff/noise`, checked with GET) and
`postedCount` must be still for 10 s (at most 90 s) before step 2, so an in-flight noise post lands before
Clear-DemoContent takes its cutoff; a failed write, a level that reads back on, or noise that never settles stops the
run (and pauses the engine). Test-DemoReady cannot flag noise posts in the opening feed: `GET /api/feed` has no origin
field, so check 5 adds a SKIP line with the noise post count and the last one's scenario time.

PR #548 review, round 2: `-ApiHost` is normalized once before any request in both scripts (bare host or http(s)
URL; scheme, trailing slash, path and query dropped; another scheme, user info, an invalid host or non-local plain
http refused with "Nothing was sent"), and only the bare host goes to the child scripts. Test-DemoReady adds check 11,
the exercise lifecycle (`GET /api/staff/exercise-lifecycle`, the signed-in exercise): `live` PASS, `staged` WARN
(pre-start page until StartEx), anything else FAIL.

PR #548 review, round 3: a demo pack that cannot be loaded (missing, unreadable, invalid JSON, not an object) is a
FAIL, and checks 6, 7, 9 and the edits route FAIL with it instead of skipping. The restart wait has an elapsed-time
budget on a monotonic clock (each request timeout and sleep capped to what is left; the real elapsed time reported).
`-ApiHost` refuses any `http://` (localhost included) and any explicit port, before any request: https on 443 only.

Existing `Clear-DemoContent`, `Import-Roster` and `Seed-DemoContent` suites: 483 passed, unchanged (full scripts/uat run: 605 passed).

**Manual (pending):** the live run on UAT, both scripts, Saturday 10/17 after the last merge (Tom).
