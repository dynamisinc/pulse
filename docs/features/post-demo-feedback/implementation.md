# Implementation: Post-demo customer feedback

> Only the load-report slice (01) is planned in detail; the other stories get a plan when they are pulled in.

## Decisions (PDF-Dn)

| # | Decision | Source |
|---|---|---|
| PDF-D1 | **The load test runs against UAT as it is (B1, one instance), Saturday 10/17 morning**, on a throwaway exercise. No infra change before the demo; the report recommends a SKU/scale for real exercises | Tom 10/15 |
| PDF-D2 | **The harness is a .NET 10 console app, `tools/Pulse.LoadTest`**, using `HttpClient` and `Microsoft.AspNetCore.SignalR.Client`, so it measures SignalR fan-out lag natively and needs nothing installed beyond the .NET SDK already on the box. No k6 | orchestrator |
| PDF-D3 | **Load users are real participant logins** provisioned with `Import-Roster.ps1` into the throwaway exercise and joined through `POST /api/auth/join`, paced under the join limit (30/min, one global bucket behind the App Service proxy), so ~4 minutes for 100 users. The token file stays local and git-ignored | orchestrator |
| PDF-D4 | **Stop rules:** abort a step when the error rate is above 5% or POST p95 above 5 s for 60 s; never run during a deploy; the demo exercise is never targeted (the harness refuses the demo exercise id) | orchestrator |
| PDF-D5 | **Steps:** 20, 40, 100 concurrent participants, 10 minutes each, with white noise High (15/min) and a 120 posts/min burst for 2 minutes in each step (NFR-002 bar) | Tom 10/15 + #526 |

## Wave plan

| Story | Owner | Stack | Files it owns | Depends on | When | Effort |
|---|---|---|---|---|---|---|
| [01 Load report](01-load-test-report.md) (#547) | planning session | tool + script + report | new `tools/Pulse.LoadTest/**`, new `scripts/uat/{New-LoadTestExercise,Remove-LoadTestExercise}.ps1`, `docs/demo/LOAD-TEST-REPORT.md` | none (runs against whatever is deployed Sat AM) | Build Fri, run Sat AM | M |

## Risks

| Risk | Mitigation |
|---|---|
| The run degrades UAT before Rehearsal 1 | Saturday morning only; stop rules; `Test-DemoReady.ps1` on the demo exercise afterwards |
| Join rate limit throttles provisioning | Pace at 25/min; never raise the limit on UAT for the test |
| SQL serverless cost over the free limit | `freeLimitExhaustionBehavior: BillOverUsage`; a 40-minute run is a small charge; noted in the report |
| Load posts pollute the export or trending on the demo exercise | Separate exercise; `Remove-LoadTestExercise.ps1` ends and archives it |
