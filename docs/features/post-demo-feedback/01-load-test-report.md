# Story: Load-test report on UAT (PDF-03 slice)

**Feature:** Post-demo customer feedback  ·  **Phase:** 2 (pulled forward)  ·  **Status:** In Review
**Requirements:** NFR-002 (burst legibility at 120 posts/min), #526  ·  **Decisions:** PDF-D1..PDF-D5  ·  **Issue:** #547
**Stack:** tool + script + report  ·  **World:** foundation  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Effort:** M
**Owner:** planning session · **Branch:** `build/post-demo-feedback/01-load-report` → PR to `main` (tool + scripts + report)

## Context

Customer notes (#526): *"Stress-test with post volume"*, *"never had more than 20 people at a time"*; Tom:
*"Stability!… Demo a backup site and switchover?"*. Nobody has measured Pulse under load, and the repo has no load
tooling. UAT is a single B1 Basic instance, in-process SignalR, serverless SQL. This slice gives a measured answer
(and a slide) for the demo: how many participants UAT carries today, where it bends, and what size a real exercise
needs. The backup site and switchover stay in #526.

## Acceptance Criteria

### Setup and teardown scripts

- [x] `New-LoadTestExercise.ps1`: as a controller (Tom signs in / `PULSE_STAFF_SECRET`), creates an exercise named
      `Load test <date>` (`POST /api/org/exercises`), sets it staged/live with watermark on, imports a generated roster of
      N participants (`Import-Roster.ps1`, auto-created citizen personas), loads a 200-post noise pool and one valid
      20-post burst item (the validator's `MaxBurstPosts`, at the minimum 3 s gap) to exercise the burst runner, and writes the join URLs to a git-ignored local file. Never touches another exercise.
- [x] `Remove-LoadTestExercise.ps1`: noise off, tier `engine`, lifecycle to completed then archived (story 22's route
      when deployed, else the lifecycle transition), and deletes the local token file.

### Harness (`tools/Pulse.LoadTest`, .NET 10 console)

- [x] Reads the join URL file, joins users at ≤ 25/min, and **refuses to run** if the target exercise id equals the
      demo exercise id (configured) or the exercise name does not start with `Load test`.
- [x] Each virtual participant holds one SignalR connection (the real hub, `accessTokenFactory` as the web client),
      reads the feed every 30 s, likes or reposts about once a minute, posts about once every 5 minutes, replies
      occasionally; the mix is configurable.
- [x] Steps 20 → 40 → 100 users, 10 minutes each (PDF-D5); in each step a controller session sets noise High and fires
      the 20-post burst item, and the harness itself drives the **120 posts/min** load for 2 minutes as paced
      `controller-as-persona` writes (`POST /api/posts`, one every 0.5 s, round-robin over NPC personas). A single run-sheet
      burst cannot reach that rate (`InjectItemValidator.MaxBurstPosts` = 20, `InjectBurstPacing.MinGapSeconds` = 3), and
      UAT stays unchanged (PDF-D1).
- [x] Measures per step: p50/p95/p99 and error rate for `POST /api/posts`, `GET /api/feed`, reaction writes, join;
      **SignalR fan-out lag** (post accepted → `PostReceived` at every other client; p50/p95/max) and dropped/late
      frames; reconnects. Writes CSV + a JSON summary.
- [x] Stop rules (PDF-D4) enforced automatically, with the reason in the summary.
- [x] Unit tests for the stats maths, the demo-exercise refusal and the stop rules.

### Run and report (Saturday 10/17 AM) — pending Tom's Saturday run

- [ ] *(pending Tom's Saturday run; the helper is built: `scripts/uat/Get-LoadTestMetrics.ps1`)* Tom runs it; `az monitor metrics` for the App Service (CPU, memory, HTTP 5xx, connections) and SQL (CPU %,
      workers, data IO) are pulled for the window by a helper in the script.
- [ ] *(pending Tom's Saturday run; the template with every section is in place)* `docs/demo/LOAD-TEST-REPORT.md`: setup, the numbers per step, where it bends (first step that breaks the NFR-002
      bar or the stop rules) and why (CPU, SQL, SignalR), a **recommended SKU/scale and whether Azure SignalR Service is
      needed** for 50 / 100 / 200 participants with a cost line, and a one-slide summary.
- [ ] *(pending Tom's Saturday run)* Afterwards `Remove-LoadTestExercise.ps1` runs and `Test-DemoReady.ps1` (demo-feedback/26) passes on the demo
      exercise.

## Build notes (10/16)

- **A second host name is required (changes the plan).** Pulse takes a participant's exercise from the request's host
  name. `JoinLoginService` gets its scope from host resolution only. `SessionAuthenticationMiddleware` returns 403 when
  a participant session and the host disagree. `ExerciseRealtimeHub` adds a connection to the host-resolved exercise
  group, staff connections included. The UAT API host is bound to the demo exercise, so a throwaway exercise's
  participants cannot join or receive `PostReceived` through it. `New-LoadTestExercise.ps1 -ExerciseHost` creates the
  exercise with an extra host name, and the harness targets only that host. Binding the host name (CNAME + `asuid` TXT
  record + `az webapp config hostname add` + managed certificate) is a UAT App Service change. It adds a binding and
  changes no app setting. PDF-D1 makes it Tom's call before Saturday. The steps are in the runbook. An exercise keeps
  its host name (there is no route to change it), so each re-run needs a fresh one.
- **Import-Roster.ps1 imports into the host's exercise.** The setup runs it with `-ApiHost <ExerciseHost>`, so it never
  imports into the demo.
- **Personas.** A new exercise has none. NPC authors for the noise pool, the burst items and the paced writes are 20
  extra roster rows (`Load NPC nn`, auto-created citizen personas) that are never joined.
- **Scenario clock.** White noise needs a running exercise clock (`WhiteNoiseService.IsStopped`). The clock starts only
  through the reaction loop or a Freeze, so the setup sets the pause tier to Freeze and then Engine paused.
- **Burst items fire once.** The setup makes three (one per step). The harness creates one if none is left.
- **Archive.** The existing lifecycle route allows completed → archived, so teardown archives without story 22.
- **Files.** `scripts/uat/Get-LoadTestMetrics.ps1` is the metrics helper. `scripts/uat/LoadTest.Common.ps1` holds the helpers the setup and teardown scripts share.
- **Projects** are in `pulse.slnx`. CI builds and tests them; the tests are pure unit tests that run in under a second.
- **SignalR client** is 10.0.13. Version 10.0.10 pulls `Microsoft.AspNetCore.SignalR.Common` with advisory
  GHSA-334f-vvp4-7g6p.

## Out of Scope

Backup site, Front Door, switchover runbook (#526 remainder); scaling UAT before the demo; fixing what the test finds
(each finding becomes an issue; anything that threatens the demo goes to Tom the same morning).

## Technical Notes

Auth: `POST /api/auth/join {token}` returns the participant session; staff via `POST /api/auth/staff/login`.
`POST /api/posts` has no rate limit (body size only); joins are 30/min in one global bucket behind the proxy;
media upload is 30/min (the harness posts text only). Add the project to the solution only if CI builds it cleanly;
otherwise keep it standalone under `tools/`.

## Dependencies

None to build. Runs against whatever is deployed Saturday morning.

## Tests

`tools/Pulse.LoadTest.Tests`: percentile maths, refusal of the demo exercise, stop rules. Script Pester tests mock
the API. The report is the evidence.
