# Story: Load-test report on UAT (PDF-03 slice)

**Feature:** Post-demo customer feedback  ·  **Phase:** 2 (pulled forward)  ·  **Status:** Not Started
**Requirements:** NFR-002 (burst legibility at 120 posts/min), #526  ·  **Decisions:** PDF-D1..PDF-D5  ·  **Issue:** —
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

- [ ] `New-LoadTestExercise.ps1`: as a controller (Tom signs in / `PULSE_STAFF_SECRET`), creates an exercise named
      `Load test <date>` (`POST /api/org/exercises`), sets it staged/live with watermark on, imports a generated roster of
      N participants (`Import-Roster.ps1`, auto-created citizen personas), loads a 200-post noise pool and one 240-post
      burst item, and writes the join URLs to a git-ignored local file. Never touches another exercise.
- [ ] `Remove-LoadTestExercise.ps1`: noise off, tier `engine`, lifecycle to completed then archived (story 22's route
      when deployed, else the lifecycle transition), and deletes the local token file.

### Harness (`tools/Pulse.LoadTest`, .NET 10 console)

- [ ] Reads the join URL file, joins users at ≤ 25/min, and **refuses to run** if the target exercise id equals the
      demo exercise id (configured) or the exercise name does not start with `Load test`.
- [ ] Each virtual participant holds one SignalR connection (the real hub, `accessTokenFactory` as the web client),
      reads the feed every 30 s, likes or reposts about once a minute, posts about once every 5 minutes, replies
      occasionally; the mix is configurable.
- [ ] Steps 20 → 40 → 100 users, 10 minutes each (PDF-D5); in each step a controller session sets noise High and fires
      the burst at 120 posts/min for 2 minutes.
- [ ] Measures per step: p50/p95/p99 and error rate for `POST /api/posts`, `GET /api/feed`, reaction writes, join;
      **SignalR fan-out lag** (post accepted → `PostReceived` at every other client; p50/p95/max) and dropped/late
      frames; reconnects. Writes CSV + a JSON summary.
- [ ] Stop rules (PDF-D4) enforced automatically, with the reason in the summary.
- [ ] Unit tests for the stats maths, the demo-exercise refusal and the stop rules.

### Run and report (Saturday 10/17 AM)

- [ ] Tom runs it; `az monitor metrics` for the App Service (CPU, memory, HTTP 5xx, connections) and SQL (CPU %,
      workers, data IO) are pulled for the window by a helper in the script.
- [ ] `docs/demo/LOAD-TEST-REPORT.md`: setup, the numbers per step, where it bends (first step that breaks the NFR-002
      bar or the stop rules) and why (CPU, SQL, SignalR), a **recommended SKU/scale and whether Azure SignalR Service is
      needed** for 50 / 100 / 200 participants with a cost line, and a one-slide summary.
- [ ] Afterwards `Remove-LoadTestExercise.ps1` runs and `Test-DemoReady.ps1` (demo-feedback/26) passes on the demo
      exercise.

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
