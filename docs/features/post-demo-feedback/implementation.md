# Implementation: Post-demo customer feedback

> Only the load-report slice (01) is planned in detail; the other stories get a plan when they are pulled in.

## Decisions (PDF-Dn)

| # | Decision | Source |
|---|---|---|
| PDF-D1 | **The load test runs against UAT as it is (B1, one instance), Saturday 10/17 morning**, on a throwaway exercise. No infra change before the demo; the report recommends a SKU/scale for real exercises | Tom 10/15 |
| PDF-D2 | **The harness is a .NET 10 console app, `tools/Pulse.LoadTest`**, using `HttpClient` and `Microsoft.AspNetCore.SignalR.Client`, so it measures SignalR fan-out lag natively and needs nothing installed beyond the .NET SDK already on the box. No k6 | orchestrator |
| PDF-D3 | **Load users are real participant logins** provisioned with `Import-Roster.ps1` into the throwaway exercise and joined through `POST /api/auth/join`, paced under the join limit (30/min, one global bucket behind the App Service proxy), so ~4 minutes for 100 users. The token file stays local and git-ignored | orchestrator |
| PDF-D4 | **Stop rules:** abort a step when the error rate is above 5% or POST p95 above 5 s for 60 s; never run during a deploy; the demo exercise is never targeted (the harness refuses the demo exercise id) | orchestrator |
| PDF-D5 | **Steps:** 20, 40, 100 concurrent participants, 10 minutes each, with white noise High (15/min) and a 120 posts/min burst for 2 minutes in each step (NFR-002 bar). The burst is **harness-paced** `controller-as-persona` writes, because one run-sheet burst is capped at 20 posts with a 3 s minimum gap; one valid 20-post burst item still runs per step to exercise the burst runner (amended 10/15 after the Copilot review on #548) | Tom 10/15 + #526 |
| PDF-D6 | **Subdomain per exercise (PDF-11, #679):** the application resolver already exists (`exercise-isolation/08`); the new story adds provisioning and settles the frontend base-URL question (the API must follow the page origin or be served on each subdomain). **Front Door vs App Service is decided at build (Tom, 10/29):** the PDF-11 builder brings costed options, either Front Door + a Key Vault wildcard cert from a CA with auto-renewal, or App Service + a Let's Encrypt wildcard via a DNS-challenge renewal job (neither App Service nor Front Door managed certs issue wildcards; issuer and renewal owner named in the story); the PDF-03 backup site can sit behind the same Front Door if that option is chosen. **Lifecycle (decided): the subdomain is kept while the exercise is archived and freed on delete; a host-name change keeps the old host as an alias.** **A freed host is quarantined for 90 days before reuse (decided, Tom, 10/29).** Proposed, to confirm with Tom: aliases count toward uniqueness and reserved names and are deleted with the exercise | Tom, 10/21 (decided); 10/29 (90-day quarantine; Front Door vs App Service decide at build) |
| PDF-D7 | **508 evidence (PDF-12):** report against WCAG 2.x AA plus the 508 chapters in a VPAT 2.5 Rev 508 ACR; automated gate = axe in Vitest plus a browser-level axe run; manual AT audit with NVDA, JAWS, VoiceOver. **Playwright is adopted** (axe a11y runs and multi-session scenarios); `@playwright/test` is already in `src/frontend/package.json` and `src/frontend/e2e/` exists from #606, so the story extends it rather than introducing it | Tom, 10/21 (decided) |
| PDF-D8 | **Back-pocket injects (PDF-13)** are a reserve lane (`IsReserve`) on the inject item, not the `held` status: `held` means paused from the timeline; reserve means never expected to fire, excluded from pending counts and time-jump disposition. **An unused reserve item stays `pending`** and shows as "Reserve (unused)" in the report (status untouched) | Tom, 10/21 (decided) |
| PDF-D9 | **December release commitment (10/20):** the epic-defined channels E3-E6 ship in December, overriding Master PRD §4 Phase 3. PDF-04 (Facebook/other social) and PDF-05 (NewsNow) are not part of it. **Confirmed FIRM (Tom, 10/21): decompose E3-E6 now**; the schedule risk is accepted. **PDF-09 server-side burn-in stays Should** (not Must) | Tom 10/20; confirmed 10/21 (decided) |
| PDF-D10 | **Cadence <-> Pulse (PDF-06, #529): Cadence drives Pulse.** Cadence owns the MSEL and the exercise clock and pushes injects and clock changes into Pulse; Pulse fires them and reports back. (Seam note added 10/29:) PR #678 made the server exercise clock authoritative (`GET /api/clock` + `ScenarioClockChanged` push), which is the seam: `IExerciseClock` was designed swappable, so a Cadence-linked clock provider plugs in. Open design: inter-product auth and the shared inject-identity contract | Tom, 10/21 (decided) |
| PDF-D11 | **Load target (PDF-DO1, #682): prove 250 concurrent accounts**, stated per configuration. **PDF-DO2 fact sheet is deferred** until the feds decide. **PDF-DO3 scenarios:** non-AI-generated content, air-gapped offline, AI-generated content, hosting / per-exercise environment; costs stay blank for Tom | Tom, 10/21 (decided) |
| PDF-D12 | **PDF-BUG fixed by PR #678** (merged 10/29), no issue. Noise posts were stamped by the server clock (frozen during a Freeze) while other posts used the browser wall clock, so feeds sorted noise below the top. Every live post is now stamped with the server clock, browsers sync to it, and the Live World cap and the unknown-author pill path are hardened | Fixed by PR #678, 10/29; no issue (orchestrator's call) |

## Wave plan

| Story | Owner | Stack | Files it owns | Depends on | When | Effort |
|---|---|---|---|---|---|---|
| [01 Load report](01-load-test-report.md) (#547) | planning session | tool + script + report | new `tools/Pulse.LoadTest/**` (+ `tools/Pulse.LoadTest.Tests`), new `scripts/uat/{New-LoadTestExercise,Remove-LoadTestExercise,Get-LoadTestMetrics,LoadTest.Common}.ps1` (+ Pester), `docs/demo/LOAD-TEST-REPORT.md` | none (runs against whatever is deployed Sat AM) | Build Fri, run Sat AM | M |

### 10/20 additions (not yet planned in detail)

| Story | Stack | Likely files | Depends on | When | Effort |
|---|---|---|---|---|---|
| [02 Subdomain per exercise](02-subdomain-per-exercise.md) (#679) | fullstack + infra | `Features/ExerciseResolution/**`, infra DNS/cert scripts (Azure Front Door), `core/services/api.ts` + `validateEnv.ts`, link/QR URL builders, isolation suite | `exercise-isolation/08`; Front Door (shared with the PDF-03 backup site) | Before December | L |
| [03 508 attestation](03-section-508-attestation.md) (#680) | process + test tooling | `docs/compliance/ACR-Pulse.md`, shared axe test util, CI config, `CLAUDE.md`, `D0-FOUNDATIONS.md` | none | Start now; refresh per release | L |
| [04 Back-pocket injects](04-back-pocket-injects.md) (#681) | fullstack | `Features/Injects/**`, `controller/runSheet/**`, run-sheet import, report | inject-queue 06/07, demo-feedback 10/23 | Before December | M |
| [05 Due-outs](05-due-outs.md) (#682-#684) | non-code | docs only | DO1 needs the 10/17 run results, then steps up to 250 | Per Tom | n/a |

## Risks

| Risk | Mitigation |
|---|---|
| The run degrades UAT before Rehearsal 1 | Saturday morning only; stop rules; `Test-DemoReady.ps1` on the demo exercise afterwards |
| Join rate limit throttles provisioning | Pace at 25/min; never raise the limit on UAT for the test |
| SQL serverless cost over the free limit | `freeLimitExhaustionBehavior: BillOverUsage`; a 40-minute run is a small charge; noted in the report |
| Load posts pollute the export or trending on the demo exercise | Separate exercise; `Remove-LoadTestExercise.ps1` ends and archives it |
| Participant joins and SignalR groups are host-bound, and the UAT API host is the demo's (found at build, 10/16) | Bind one extra host name to the App Service for the load-test exercise (`New-LoadTestExercise.ps1 -ExerciseHost`); runbook in `tools/Pulse.LoadTest/README.md`. Without it the participant half cannot run on UAT |
| The December commitment for E3-E6 has no decomposed stories (10/20) | **Accepted by Tom (10/21): the commitment is firm.** Decomposed on 10/29 in PR #686 (`docs/features/DECEMBER-RELEASE.md`, issues #688-#786); raise early if the date cannot hold |
| The 508 attestation claims more than the audit supports | Report Partially Supports honestly; no claim without evidence (PDF-12) |
