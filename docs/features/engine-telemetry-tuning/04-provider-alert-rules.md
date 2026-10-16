# Story: Provider alert rules (errors, latency, spend)

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8 (cross-cutting: NFR-009 monitoring/alerting; brief track 7)  ·  **Phase:** 2 (v1) — engine go-live wave C1  ·  **Status:** Built, NOT Complete — authored on `feature/engine-golive-alert-rules` (`bicep build` / `build-params` / `lint` clean, `main.json` regenerated). Gate-1 review fixes folded (sampling-weighted counts, timeout-ratio Sev-2 latency rule, min-call guards, root thresholds, secure/masked owner email). **Lands OFF on UAT** (`deployProviderAlerts = false` in `uat.bicepparam`): merging activates nothing. Still needs **Tom's Tier-2 infra sign-off**, the `PULSE_ALERT_OWNER_EMAIL` secret on the `uat` environment, the **one-line follow-up flip** to `true`, and **UAT verification** (a `what-if`, the deploy, and a forced test fire reaching the owner's inbox — AC7). Nothing deployed yet.
**Requirements:** ADP-041 (operational counterpart), NFR-003 (degraded-mode trip), NFR-005 (governed provider)  ·  **Design decisions:** none  ·  **Issue:** —

> **TIER-2 / infra change: Tom Bull must sign off before merge** (`docs/NEXT-WAVE-SESSION-BRIEF.md` C5: "Tom signs off schema, isolation, security and infra changes").
> Counts toward track 7 (monitoring and alerting, `NEXT-WAVE-SESSION-BRIEF.md` B1 "Production").

## Context
PROVIDER-GOVERNANCE §8 was signed 2026-10-16 (Tom Bull) and PR #571 flips UAT to the live provider
(Ambient tier, suggest-only). From that moment real money and real latency are in play and nobody is
told when the provider misbehaves: the usage panel (#401, story 03) is a pull surface a controller has to
open, and the degraded-mode breaker (engine-generation-infra 05) clamps the engine to Suggest *silently*
as far as the owner is concerned. This story adds **push** alerts on the live generation provider:
**errors, latency and spend**, delivered to the owner by email.

**Staff/ops world, infrastructure only** — no participant surface, no frontend, no new endpoint.

### What the monitoring module is today (verified)
- `infrastructure/modules/appinsights.bicep` creates the workspace-based Application Insights
  component (`appi-<suffix>`, `Application_Type: web`, `IngestionMode: LogAnalytics`) and outputs `id`,
  `connectionString`, `instrumentationKey`. `infrastructure/modules/loganalytics.bicep` creates the workspace.
  Both are gated by `deployMonitoring` in `infrastructure/main.bicep` (module `appInsights`, ~line 280).
- There are **no alert rules, action groups or `scheduledQueryRules` anywhere in `infrastructure/`** today
  (grep verified) — this story creates the first, as a new module.
- The App Service already ships telemetry to it: `Program.cs` calls `AddApplicationInsightsTelemetry()`
  (`Microsoft.ApplicationInsights.AspNetCore` 2.22) and `main.bicep` passes `appInsightsConnectionString`
  to the web app. That SDK **auto-collects outbound HTTP as `dependencies`** — the engine's generation
  calls run through the typed `HttpClient` with the `engine-generation` resilience handler
  (`Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs`), so each model call is a dependency row
  whose `target` is the Foundry host `aif-pulse-uat.cognitiveservices.azure.com`
  (`main.bicep` `generationEndpoint`, built from `aiFoundryName`).

### Where the numbers come from (and the honest gap on spend)
| Signal | Source today | Reachable by Azure Monitor? |
|---|---|---|
| Errors | `dependencies` rows with `success == false` for the Foundry host (auto-collected) | **Yes** |
| Latency | `dependencies.duration` for the same host (per attempt, i.e. the same unit as the 10 s per-attempt timeout `Generation:Resilience:AttemptTimeoutSeconds`) | **Yes** |
| Breaker opened / engine degraded | `dependencies` failures + `exceptions`/`traces` carrying `BrokenCircuitException` (Polly) from the tick's `LogTickFailed` | **Yes** (best-effort text match) |
| **Tokens / cost** | `engine.generated` rows in the **SQL `TelemetryEvents` table** (`EngineEventPayloads.Generated`, emitted by `ReactionLoopHost.BuildGeneratedEvent`), rolled up by `EngineUsageService` behind `GET /api/engine/usage` and priced from `Generation:Pricing`. **Not in Application Insights.** | **No** |

So a *token-accurate* spend alert is **not possible from Azure Monitor today**. This story ships a
**call-volume spend proxy** (model calls per hour from `dependencies`, thresholded against the measured
cost-per-call envelope) which needs no code change, and records the token-accurate variant as a follow-up
(see Out of Scope / Open question). The proxy is honest because cost is call-driven and the measured token
profile is stable (~992 in / ~200 out per 4-post burst; `engine-generation-infra/MEASURED-RESULTS.md`).

## Acceptance Criteria
- [x] **Gated, default off.** Given `infrastructure/main.bicep`, when it is deployed with defaults (and
      for every environment parameter file that omits it), then NO alert rule and NO action group is
      created: a new `param deployProviderAlerts bool = false` gates a single new module call, and it
      additionally requires `deployMonitoring && deployAi` (an alert on a provider that is not deployed,
      or with no App Insights to read, is a deploy error, not a silent no-op). `parameters/uat.bicepparam`
      carries the block and is the only file that will set it `true` — **amended (Gate-1 H-2):** it LANDS
      `false` and flips to `true` in a one-line follow-up once the `PULSE_ALERT_OWNER_EMAIL` secret exists on
      the `uat` environment, so merging does not activate alerts. `what-if` against a non-UAT parameter set shows zero alert resources.
- [x] **Owner email is a parameter, never a literal.** Given the action group, when it is authored, then
      its single email receiver comes from the module's required `alertOwnerEmail` param, fed by a ROOT
      `param alertOwnerEmail string = ''` in `main.bicep` (an empty default, so parameter sets that omit it
      still deploy with alerts off — ARM requires undefaulted params even when the consuming module is
      disabled; in no template output; `@secure()` and masked in the workflow log — amended Gate-1 M-3), the UAT value is sourced the same way the other UAT inputs are
      (`readEnvironmentVariable('PULSE_ALERT_OWNER_EMAIL', '')` in `uat.bicepparam`), and
      `deployProviderAlerts = true` with an empty `alertOwnerEmail` **fails the deploy with a clear message**
      (an alert nobody receives is worse than none). `grep -rn "@" infrastructure/ | grep -i "alert"` finds no
      hard-coded address.
- [x] **Error alert.** Given Foundry-host dependencies in `appi-<suffix>`, when the failed-call ratio over a
      15-minute window exceeds a threshold (param, default 20 %) with a minimum call count (param, default 5;
      counts are `sum(itemCount)` because App Insights adaptive sampling is on — Gate-1 H-1)
      — or the breaker-open signature (`BrokenCircuitException`) appears — then a Sev-2 alert fires to the
      action group. The query is scoped to the Foundry host by `target has '<aiFoundryName>'` (taken from the
      module parameter, not re-typed), so an unrelated failing dependency (SQL, Storage) never trips it.
- [x] **Latency alert, against the real thresholds.** Given the same dependencies, with at least a minimum
      number of attempts in the 15-minute window (param, default 5), when the p95 of `duration` exceeds
      **5 s** (≈2x the measured Standard p95 of 2.7 s, `MEASURED-RESULTS.md`) a Sev-3 warning fires, and
      when the share of attempts with `duration >= 95 %` of **10 s** (the per-attempt degraded-mode trip,
      `AttemptTimeoutSeconds`, asserted in `ProviderLiveConfigTests`) exceeds a timeout-ratio threshold
      (param, default 5 %) a Sev-2 alert fires. **Amended (Gate-1 M-1/M-2):** the Sev-2 rule is a timeout
      ratio, not "p95 > 10 s", because the Polly timeout cancels an attempt at 10 s so its recorded duration
      sits on that edge. The thresholds are bicep params with those defaults (exposed at the root of
      `main.bicep`), and a code comment cites the two source documents so a future change to the trip
      threshold knows to move the alert with it.
- [x] **Spend alert (call-volume proxy).** Given the Foundry-host call count per hour, when it exceeds a
      threshold param (default sized from `MEASURED-RESULTS.md`: nominal active-storyline hour ≈ 375 bursts,
      so alert at ~2x = 750 calls/h; ≈ $1.20/h at the Ambient rate of $0.0016/burst) a Sev-3 alert fires; the
      rule's description states plainly that it is a call-volume proxy and points at the usage panel
      (`GET /api/engine/usage`, story 03) for token-accurate cost.
- [x] **No live-egress side effect and no new telemetry.** Given the deployed module, when reviewed, then it
      only READS existing App Insights data (scheduled query rules, `Microsoft.Insights/scheduledQueryRules`,
      scoped to the `appInsights` component id) — no app-setting change, no `Generation__*` change, no new
      custom metric, no code change, no EF/schema change. The module has no parameter that can reach a
      provider endpoint (NFR-005 posture unchanged).
- [ ] **Alerts are verifiable on UAT.** Given the rules are deployed with PR #571's live provider, when the
      owner runs the documented verification (temporarily lower the latency or call-count threshold param, or
      run the `KQL` in the portal against the last hour's real traffic), then the query returns the expected
      rows and a test fire reaches the owner's inbox; the result is recorded in the story's Tests section.
      **Also confirm (Gate-1 M-1):** an attempt the Polly timeout cancels appears as a `dependencies` row
      with a duration of about 10 s (`success == false`). The Sev-2 timeout-ratio rule depends on it.
- [x] **Docs.** `infrastructure/README.md` gains the toggle row (`deployProviderAlerts`) and a short
      "Provider alerts" section (what fires, who is told, how to silence); `docs/guide/troubleshooting.md`
      gains a short "I got a provider alert" entry linking to the engine kill switch / cut-to-Fake lever
      (autonomy-safety 03/07) as the first response. (Docs-as-done, brief C5.)

## Out of Scope
- **Token-accurate / dollar-accurate spend alerting.** Needs the engine to publish a custom metric (e.g.
  `TrackMetric("engine.generation.cost_usd")`) at the point it writes `engine.generated`, or a SQL-backed
  alert. That is a small **backend code change** and therefore not in this infra-only story — recorded as the
  open question below, to be decided by Tom after seeing real UAT spend.
- **An Azure Cost Management budget** (subscription/resource-group scope) — complementary, but a separate
  billing-scope decision for Tom.
- **Prod/multi-tenant alert routing** (per-customer action groups, on-call, paging) — the multi-tenant SaaS
  track; this story is UAT-first and parameterised so it can be reused.
- Dashboards/workbooks; changing any threshold in the engine itself; any frontend.

## Technical Notes
- **World:** staff/ops (infrastructure). No participant surface; no scenario-time, a11y or isolation AC
  applies (no route, no participant data). Exercise isolation is not at stake: the queries read provider-call
  telemetry, which carries no exercise payload.
- **Files:** new `infrastructure/modules/provider-alerts.bicep` (action group + four (latency is two: Sev-3 p95 + Sev-2 timeout ratio)
  `scheduledQueryRules@2023-03-15-preview`; params: `location`, `appInsightsId`, `aiFoundryName`,
  `ownerEmail`, thresholds, `tags`); one additive module block + the new params in `infrastructure/main.bicep`
  next to the `appInsights` module; the UAT line in `infrastructure/parameters/uat.bicepparam`; regenerate the
  checked-in `infrastructure/main.json`; docs in `infrastructure/README.md` and `docs/guide/troubleshooting.md`.
  `.github/workflows/deploy-infrastructure.yml` needs `PULSE_ALERT_OWNER_EMAIL` passed into the bicep step
  (a workflow edit — flag it in the PR; it is not an orchestrator-owned file but is Tom-signed infra).
- **No orchestrator-owned file** (`Program.cs`, `App.tsx`, `staffRouteRegistry.tsx`) is touched.
- **No schema / EF migration** (C1 rule 1).
- Query shape (illustrative): `dependencies | where target has '<aiFoundryName>' | summarize p95=percentile(duration,95), calls=count(), failed=countif(success == false) by bin(timestamp, 15m)`.
  Latency is `duration` in ms. Use `evaluationFrequency` 5 min / `windowSize` 15 min; `skipQueryValidation`
  off so a bad table name fails at deploy.
- See `implementation.md` (story 04 row) for the wave.

## Dependencies
`deployMonitoring` + `deployAi` modules (already on UAT); PR #571 (UAT live provider) so there is real
traffic to alert on; Tom's infra sign-off. Independent of stories 01-03 code.

## Tests
- `az bicep build` / `bicep lint` clean; `what-if` on `uat.bicepparam` shows the action group + four rules;
  `what-if` with defaults shows none; the empty-email case fails with the message.
- Manual: run each KQL against UAT's last hour; temporarily lower a threshold to force one fire; confirm the
  email arrives; revert. Record the result here.

### Test record (2026-10-16, build only; no Azure call made)
- `bicep build infrastructure/main.bicep`: clean (exit 0, no diagnostics), Bicep CLI 0.48.1 (the
  version `main.json` was already generated with). `main.json` regenerated from it.
- `bicep build-params infrastructure/parameters/uat.bicepparam`: clean (exit 0).
- `bicep lint` on `main.bicep` and `modules/provider-alerts.bicep`: clean.
- `grep -rn "@" infrastructure/ | grep -i "alert"`: matches only bicep decorators (`@description`,
  `@minLength`, ...) and resource type strings; **no email address**.
- Re-run after the Gate-1 fixes (Bicep CLI 0.48.1): `build` exit 0, `build-params` exit 0, `lint` on
  `main.bicep` and the module exit 0, no diagnostics; `main.json` regenerated.
- **Not yet run (needs Azure, Tom's call):** `what-if` with UAT params (expect 1 action group + 4 rules),
  `what-if` with defaults (expect none), the empty-email fail message, the KQL against live traffic, and
  the forced test fire. Record them here.

## Tasks
- [x] `infrastructure/modules/provider-alerts.bicep` — action group + scheduled query rules (errors/breaker,
      latency warning, latency trip, spend proxy), thresholds as params with the AC defaults.
- [x] `infrastructure/main.bicep` — `deployProviderAlerts` (default false), `@secure()` `alertOwnerEmail`
      (default `''`), `fail()` guard (alerts on requires `deployMonitoring && deployAi` and a non-empty email),
      root threshold params (`providerAlertCallsPerHourThreshold`, `providerAlertLatencyWarningMs`,
      `providerAlertLatencyAlertMs`, `providerAlertTimeoutRatioPercentThreshold`), module call.
- [x] `infrastructure/parameters/uat.bicepparam` — new block at the end of the file (clear of PR #571's lines),
      landing with `deployProviderAlerts = false`.
- [x] `.github/workflows/deploy-infrastructure.yml` — `PULSE_ALERT_OWNER_EMAIL` secret into the What-If and
      Deploy steps, and registered with `::add-mask::` in the mask step (Tom-signed infra; flag in the PR).
- [x] Gate-1 fixes (H-1, H-2, M-1..M-4, L-1..L-3) folded in one follow-up commit.
- [x] Regenerate `infrastructure/main.json`.
- [x] Docs: `infrastructure/README.md` (toggle row, CI secret, "Provider alerts" section),
      `docs/guide/troubleshooting.md` ("I got a provider alert").
- [ ] Tom: create the `PULSE_ALERT_OWNER_EMAIL` secret on the `uat` GitHub environment.
- [ ] Tom: Tier-2 infra sign-off.
- [ ] Follow-up (one line): set `deployProviderAlerts = true` in `uat.bicepparam` once the secret exists.
- [ ] UAT: what-if, deploy, run the KQL on live traffic, force one fire, record it above (AC7).

## Build notes
- **Four rule resources, not three.** A scheduled query rule carries one severity, and the latency AC
  needs a Sev-3 warning (5 s p95) and a Sev-2 alert (timeout ratio at the 10 s trip), so latency is two rules. Three alert *kinds*,
  four `scheduledQueryRules`.
- **Rule shape.** Each KQL returns a row only when its condition holds; every rule fires on result
  rows > 0 (`timeAggregation: Count`, `GreaterThan 0`, 1 of 1 periods, `autoMitigate`). The rule window
  is the query time range (errors/latency 15 min every 5 min; spend 1 h every 15 min).
  `skipQueryValidation: false`.
- **What the queries match.** `dependencies | where target has "<aiFoundryName>"`, taken from the
  module param (fed by main.bicep's `aiFoundryName` var). The App Insights SDK records each outbound
  HTTP attempt from the typed `HttpClient` (`AddHttpProvider`, `engine-generation` pipeline) with
  `target` = the request host, so retries count as separate rows and Polly-timed-out attempts are
  expected to show up as failures with a ~10 s duration (to confirm on UAT, AC7).
  **Sampling (Gate-1 H-1):** `Program.cs` uses default adaptive sampling, so every count is
  `sum(itemCount)` / `sumif(itemCount, ...)`. The 5 s p95 stays unweighted (a percentile over the retained
  rows is not biased by sampling); a comment in the module says so. The Claude passthrough host (`<name>.services.ai.azure.com`) also
  matches. **No `type` or `name` filter**: not needed for correctness, and the exact values could not
  be confirmed without live data. The README's verification query groups by `type, name` so the first
  live hour can confirm there is exactly one row per call.
- **Breaker signature.** The `OnOpened` hook does not log, and an open breaker makes no HTTP call, so
  there is no dependency row for it. The error rule therefore also counts `exceptions` rows whose `type`
  or `details` contain `BrokenCircuitException` (a rejected call surfaces in the tick's logged
  exception chain). `engine-generation` is the only Polly circuit breaker in `src/`, so the match is
  specific to it. Best-effort text match, as the story says. It relies on the exception reaching
  `ReactionLoopHost.LogTickFailed` (directly or as an inner exception); a future catch-and-swallow on that
  path would blind this branch. The module comment records this (Gate-1 L-3).
- **Fail-clearly.** `main.bicep` computes the owner email through a nested `if()` whose untaken branches
  call `fail()`; ARM evaluates only the taken branch, so with alerts off nothing fails. The module also
  has `@minLength(3)` on `alertOwnerEmail` as a backstop. The error text is confirmed by the compiled
  template only; the live deploy failure is in the UAT checklist above.
- **Owner email (Gate-1 M-3).** `@secure()` at the root and in the module (checked first: `trim()` and
  `fail()` in the guard still compile and lint clean with a secure param), so it is not recorded in the
  deployment parameters/history. The workflow registers it with `::add-mask::` (skipped when empty). It is
  in no template output, but it IS readable on the deployed action group (an email receiver is not a
  secret property). The README says exactly this.
