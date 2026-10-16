# Pulse UAT load-test report

> **TEMPLATE. Nothing below is measured yet.** Tom fills it in after the Saturday 10/17 run
> (story [post-demo-feedback/01](../features/post-demo-feedback/01-load-test-report.md), #547; decisions PDF-D1..D5).
> Every `‹…›` is a placeholder. Fill it from the harness output (`loadtest-results/run-<ts>/summary.json` and
> `steps.csv`) and the metrics CSV (`scripts/uat/logs/loadtest-metrics-<ts>.csv`). Leave a placeholder visibly blank
> rather than estimate. Runbook: [`tools/Pulse.LoadTest/README.md`](../../tools/Pulse.LoadTest/README.md).

**Question.** How many participants does UAT carry today, where does it bend, and what does a real exercise need?
**Answer (one line).** ‹UAT as configured carried __ concurrent participants at the NFR-002 bar; it bent at __ users
because __; a __-participant exercise needs __.›

## 1. Setup

| Item | Value |
|---|---|
| Date and window (UTC) | ‹2026-10-17, hh:mm–hh:mm› (`summary.json` startedAt / endedAt) |
| Deployed build | ‹commit sha / Deploy Backend run #› |
| App Service | `app-pulse-api-uat-dynamis` on plan `asp-pulse-uat`, **B1 Basic, 1 instance**, in-process SignalR (no Azure SignalR Service) |
| Database | `sqldb-pulse-uat`, Azure SQL **serverless** ‹vCore min/max, auto-pause 60 min›. ‹Resumed from pause at start: yes/no, __ s› |
| Target | Throwaway exercise ‹`Load test 2026-10-17 hhmm`› (‹exercise id›) on ‹load-test host name›. The demo exercise was refused by the harness and untouched |
| Users | Real participant logins from a generated roster (Import-Roster.ps1), joined at ‹25›/min through `POST /api/auth/join` |
| Per user | One SignalR connection (`/hubs/exercise`). Feed read every 30 s. Like or repost about once a minute. A post about every 5 min, about 25% of them replies |
| Steps | 20 → 40 → 100 users, 10 min each (PDF-D5) |
| Per step | White noise High (15/min). One 20-post run-sheet burst item (57 s window). **120 posts/min for 2 min**, harness-paced `controller-as-persona` writes (NFR-002 bar) |
| Stop rules | Error rate above 5%, or POST p95 above 5 s, sustained 60 s (PDF-D4) |
| Harness host | ‹Tom's machine / network; distance to Central US› |
| Deviations | ‹anything that differed from the plan, e.g. a step skipped, a re-run, someone signing in to the demo during the ramp› |

## 2. Numbers per step

Latency in milliseconds. Error rate = non-2xx answers or no answer. Fill one column per step that ran. A step a stop
rule ended gets its partial numbers and the reason.

| Measure | 20 users | 40 users | 100 users |
|---|---|---|---|
| Users joined / connected at start | ‹ / › | ‹ / › | ‹ / › |
| Step outcome | ‹completed / stopped: reason› | ‹ › | ‹ › |
| `POST /api/posts` (all) p50 / p95 / p99 | ‹ › | ‹ › | ‹ › |
| `POST /api/posts` error rate | ‹ › | ‹ › | ‹ › |
| — during the 120/min burst (controller-post) p95 | ‹ › | ‹ › | ‹ › |
| `GET /api/feed` p50 / p95 / p99 | ‹ › | ‹ › | ‹ › |
| `GET /api/feed` error rate | ‹ › | ‹ › | ‹ › |
| Reactions p50 / p95 / p99 | ‹ › | ‹ › | ‹ › |
| Reactions error rate | ‹ › | ‹ › | ‹ › |
| Join p50 / p95 (ramp) | ‹ › | ‹ › | ‹ › |
| Join errors (429s) | ‹ › | ‹ › | ‹ › |
| SignalR fan-out lag p50 / p95 / max | ‹ › | ‹ › | ‹ › |
| Frames delivered / late (>2 s) / dropped | ‹ › | ‹ › | ‹ › |
| Dropped frames that were join-window artefacts (`fanout-drops.csv`, secondsAfterConnect < 1) | ‹ › | ‹ › | ‹ › |
| Reconnects / closed / connect failures | ‹ › | ‹ › | ‹ › |
| App Service CPU % avg / max | ‹ › | ‹ › | ‹ › |
| App Service memory % avg / max | ‹ › | ‹ › | ‹ › |
| HTTP 5xx (count) | ‹ › | ‹ › | ‹ › |
| App connections max | ‹ › | ‹ › | ‹ › |
| SQL CPU % avg / max | ‹ › | ‹ › | ‹ › |
| SQL workers % max | ‹ › | ‹ › | ‹ › |
| SQL data IO % max | ‹ › | ‹ › | ‹ › |

**NFR-002 bar** (feeds stay smooth and readable at 120 posts/min): ‹met / not met at each step. Use the burst-window
POST p95, the fan-out p95 and late or dropped frames as the evidence›.

## 3. Where it bends, and why

- **First step that broke the bar or a stop rule:** ‹step, users, minute, which rule (from `stopReason`)›. If none:
  ‹"none up to 100 users"›.
- **What saturated first:** ‹App Service CPU / memory / SQL CPU or workers / SignalR (fan-out lag or drops while CPU
  had headroom) / the client›. Evidence: ‹the metrics CSV rows and steps.csv rows that show it›.
- **Feed reads:** `GET /api/feed` returns the whole feed as one unpaged array, so its cost grows with the posts written.
  ‹Did feed p95 grow step over step faster than the user count?›
- **Join limit:** joins share one 30/min bucket behind the App Service proxy (#480). 100 participants take about
  4 minutes to sign in. ‹Any 429s?›
- **Serverless SQL:** ‹resume delay at the start; did auto-scale track the load?›
- **Anything else seen:** ‹errors in Application Insights, exceptions, restarts›.

Each finding becomes an issue: ‹#…›. Anything that threatens the demo went to Tom the same morning.

## 4. Recommendation: SKU and scale

Base this on the measured bend point and headroom, not on the list below. In-process SignalR keeps every connection on
the App Service instance. Scaling out to more than one instance needs either
**Azure SignalR Service** (`infrastructure/modules/signalr.bicep` exists; UAT has `deploySignalR = false`) or a
backplane. Without one, users on different instances miss each other's posts.

| Participants | App Service plan (SKU × instances) | Azure SignalR Service | SQL | Est. monthly cost | Basis |
|---|---|---|---|---|---|
| 50 | ‹e.g. stay on B1 / move to …› | ‹not needed / Free / Standard × units› | ‹serverless max vCores› | ‹$ (Azure pricing calculator, Central US, date)› | ‹measured step› |
| 100 | ‹ › | ‹ › | ‹ › | ‹$› | ‹ › |
| 200 | ‹ › (extrapolated: say so) | ‹ › | ‹ › | ‹$› | ‹ › |

- **Cost line:** ‹the delta over today's UAT spend for an exercise day and for a month; the SQL serverless charge for
  the test itself (`freeLimitExhaustionBehavior: BillOverUsage`)›.
- **Before a real exercise:** ‹e.g. paginate the feed, partition the join limiter per client IP behind the proxy,
  pre-warm SQL›.

## 5. One-slide summary

> **Pulse under load (UAT, ‹date›)**
>
> - Tested ‹20 / 40 / 100› concurrent participants with real logins and live feeds, plus 120 posts/min bursts
>   (NFR-002) and white noise High.
> - **Carried ‹N› participants** with posting p95 ‹x› s and live-feed delivery p95 ‹y› s; ‹0› lost updates.
> - **Bent at ‹M› participants:** ‹one clause on why›.
> - **For a real exercise:** ‹50 → …; 100 → …; 200 → …›, about ‹$/month›. ‹Azure SignalR Service needed from __
>   participants.›
> - Measured on today's single small UAT server (B1). Production sizing follows the table above.

## Appendix: run artefacts

- Harness output: ‹path to `loadtest-results/run-<ts>/`›. Keep it out of git. Attach `summary.json` and `steps.csv` to
  #547.
- Metrics: ‹path to `loadtest-metrics-<ts>.csv`›.
- Teardown: `Remove-LoadTestExercise.ps1` ‹DONE / NOT CLEAN: …›. `Test-DemoReady.ps1` on the demo exercise:
  ‹READY / NOT READY›.
