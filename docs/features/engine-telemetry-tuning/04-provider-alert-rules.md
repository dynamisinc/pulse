# Story: Provider alert rules (errors, latency, spend)

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8 (cross-cutting: NFR-009 monitoring/alerting; brief track 7)  ·  **Phase:** 2 (v1) — engine go-live wave C1  ·  **Status:** Not Started
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
- [ ] **Gated, default off.** Given `infrastructure/main.bicep`, when it is deployed with defaults (and
      for every environment parameter file that omits it), then NO alert rule and NO action group is
      created: a new `param deployProviderAlerts bool = false` gates a single new module call, and it
      additionally requires `deployMonitoring && deployAi` (an alert on a provider that is not deployed,
      or with no App Insights to read, is a deploy error, not a silent no-op). `parameters/uat.bicepparam`
      sets it `true`; nothing else does. `what-if` against a non-UAT parameter set shows zero alert resources.
- [ ] **Owner email is a parameter, never a literal.** Given the action group, when it is authored, then
      its single email receiver comes from the module's required `alertOwnerEmail` param, fed by a ROOT
      `param alertOwnerEmail string = ''` in `main.bicep` (an empty default, so parameter sets that omit it
      still deploy with alerts off — ARM requires undefaulted params even when the consuming module is
      disabled; never echoed in outputs), the UAT value is sourced the same way the other UAT inputs are
      (`readEnvironmentVariable('PULSE_ALERT_OWNER_EMAIL', '')` in `uat.bicepparam`), and
      `deployProviderAlerts = true` with an empty `alertOwnerEmail` **fails the deploy with a clear message**
      (an alert nobody receives is worse than none). `grep -rn "@" infrastructure/ | grep -i "alert"` finds no
      hard-coded address.
- [ ] **Error alert.** Given Foundry-host dependencies in `appi-<suffix>`, when the failed-call ratio over a
      15-minute window exceeds a threshold (param, default 20 %) with a minimum call count (param, default 5)
      — or the breaker-open signature (`BrokenCircuitException`) appears — then a Sev-2 alert fires to the
      action group. The query is scoped to the Foundry host by `target has '<aiFoundryName>'` (taken from the
      module parameter, not re-typed), so an unrelated failing dependency (SQL, Storage) never trips it.
- [ ] **Latency alert, against the real thresholds.** Given the same dependencies, when the 15-minute p95 of
      `duration` exceeds **5 s** (≈2x the measured Standard p95 of 2.7 s, `MEASURED-RESULTS.md`) a Sev-3
      warning fires, and when it exceeds **10 s** (the per-attempt degraded-mode trip threshold,
      `AttemptTimeoutSeconds`, asserted in `ProviderLiveConfigTests`) a Sev-2 alert fires. Both thresholds
      are bicep params with those defaults, and a code comment cites the two source documents so a future
      change to the trip threshold knows to move the alert with it.
- [ ] **Spend alert (call-volume proxy).** Given the Foundry-host call count per hour, when it exceeds a
      threshold param (default sized from `MEASURED-RESULTS.md`: nominal active-storyline hour ≈ 375 bursts,
      so alert at ~2x = 750 calls/h; ≈ $1.20/h at the Ambient rate of $0.0016/burst) a Sev-3 alert fires; the
      rule's description states plainly that it is a call-volume proxy and points at the usage panel
      (`GET /api/engine/usage`, story 03) for token-accurate cost.
- [ ] **No live-egress side effect and no new telemetry.** Given the deployed module, when reviewed, then it
      only READS existing App Insights data (scheduled query rules, `Microsoft.Insights/scheduledQueryRules`,
      scoped to the `appInsights` component id) — no app-setting change, no `Generation__*` change, no new
      custom metric, no code change, no EF/schema change. The module has no parameter that can reach a
      provider endpoint (NFR-005 posture unchanged).
- [ ] **Alerts are verifiable on UAT.** Given the rules are deployed with PR #571's live provider, when the
      owner runs the documented verification (temporarily lower the latency or call-count threshold param, or
      run the `KQL` in the portal against the last hour's real traffic), then the query returns the expected
      rows and a test fire reaches the owner's inbox; the result is recorded in the story's Tests section.
- [ ] **Docs.** `infrastructure/README.md` gains the toggle row (`deployProviderAlerts`) and a short
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
- **Files:** new `infrastructure/modules/provider-alerts.bicep` (action group + three
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
- `az bicep build` / `bicep lint` clean; `what-if` on `uat.bicepparam` shows the action group + three rules;
  `what-if` with defaults shows none; the empty-email case fails with the message.
- Manual: run each KQL against UAT's last hour; temporarily lower a threshold to force one fire; confirm the
  email arrives; revert. Record the result here.
