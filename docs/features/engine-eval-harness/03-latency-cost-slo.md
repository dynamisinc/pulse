# Story: Latency/cost SLO measurement

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1) — engine go-live wave C1  ·  **Status:** Not Started
**Requirements:** NFR-002, NFR-003  ·  **Design decisions:** none  ·  **Issue:** #177

## Context
Refreshed 2026-10-16 for the live provider. PROVIDER-GOVERNANCE §8 is signed (Tom Bull) and PR #571 flips
UAT to the live provider (Ambient tier, suggest-only), so this story's old blocker ("needs live-provider
pass") is gone. The one-time spike (engine-generation-infra 06) produced `MEASURED-RESULTS.md` (2026-07-18:
Standard gpt-5.4 p95 2655 ms, Ambient gpt-5.4-mini p95 1983 ms, ~$0.0056 / ~$0.0016 per 4-post burst; per-attempt
trip threshold set to 10 s from that). This story is the **ongoing SLO check on the live UAT provider**, in two
deliberately separate layers so scope stays tight:

1. **In-CI threshold assertion (already built, no new work):** `ProviderLiveConfigTests.
   GovernedExample_TripThreshold_IsTunedToMeasuredP95_AndFlagsIfApproaching` asserts the governed config's
   `Resilience.AttemptTimeoutSeconds` is 10 s AND that the recorded measured p95 stays under 70 % of it.
   It runs on `Fake`, needs no key, and is the regression gate. This story only **keeps its recorded p95
   constants honest**: when the live pass below re-measures, the constants (`MeasuredStandardP95Ms`,
   `MeasuredAmbientP95Ms`) are updated in the same PR so the CI gate tracks reality.
2. **Out-of-CI live measurement against UAT (the new work):** the same way PROVIDER-GOVERNANCE §6 runs the
   keyed pass — `eval/live-provider.runsettings` (`PULSE_LIVE_FOUNDRY=1`), `MeasuredCostLatencyTests`, never
   in CI — pointed at the **live UAT endpoint and the deployments PR #571 actually switched on** (Ambient
   tier first). It records p50/p95 and per-burst cost, writes the result into `MEASURED-RESULTS.md` as a
   dated "UAT live" run, and compares against the envelope (architecture §4.1) and the 10 s trip threshold.
   Cost uses the config-sourced `Generation:Pricing` table the usage panel already reads (engine-telemetry-tuning
   03), not a second hardcoded price list.

Continuous alerting on live traffic is a different story (engine-telemetry-tuning 04, provider alert rules).

## Acceptance Criteria
- [ ] Given the live UAT provider (PR #571) and `eval/live-provider.runsettings`, when
      `MeasuredCostLatencyTests` runs out-of-CI per PROVIDER-GOVERNANCE §6, then it records p50/p95 latency and
      per-burst cost for each tier actually enabled on UAT (Ambient required; Standard if enabled) at the
      representative 4-persona burst size.
- [ ] Given the measured p95, when compared with the envelope (architecture §4.1) and the 10 s per-attempt
      trip threshold, then a breach (p95 >= 70 % of the threshold, or per-burst cost above the modeled
      budget) is reported as a failing result with the numbers in the message.
- [ ] Given a fresh live run, when it completes, then `engine-generation-infra/MEASURED-RESULTS.md` gains a
      dated "UAT live" row (endpoint, api-version, model id/version, iterations, p50/p95, tokens in/out/cached,
      ~$/burst, ~$/exercise-hour), and the `ProviderLiveConfigTests` recorded p95 constants are updated to the
      new worst-case so the in-CI assertion (`< 70 %` of the 10 s threshold) continues to guard the current reality.
- [ ] Given the in-CI run, when `ProviderLiveConfigTests` executes on `Fake` with no key, then the threshold
      assertion still passes and the live pass is NOT executed (no egress from CI; NFR-005).
- [ ] Given a provider/model/prompt change (including an unpinned model-version upgrade, per §8 evidence
      (iv)), when the live pass is re-run before shipping, then a latency or cost regression is visible against
      the previous "UAT live" row.
- [ ] Reports are staff/tuning-facing only (XC-002); the live run uses only the tenant-bounded UAT endpoint
      with keyless Entra auth (NFR-005); the run's prompts contain only synthetic scenario content.
- [ ] **User guide:** no `docs/guide/` impact (eval tooling, no staff/participant workflow) — stated in the PR.

## Out of Scope
The one-time spike (engine-generation-infra 06); the degraded-mode fallback behaviour (05); cost
*optimisation* (04); **continuous production monitoring/alerting** (engine-telemetry-tuning 04); a new SLO
framework/dashboard; re-running the injection red-team or voice-diversity live passes (separate §6 filters —
re-run only if the config drifted); any change to the 10 s threshold itself (that is a data-driven change to
`appsettings`/bicep, owned by engine-generation-infra 05, only proposed here if the measurement says so); the
Claude-on-Foundry comparison (`PROVIDER-COMPARISON.md`).

## Technical Notes
Staff/backend, out-of-CI. Files: `src/Pulse.Core.Tests/Features/Generation/MeasuredCostLatencyTests.cs`
(retarget/parametrise for UAT's live deployment if it is not already driven by config),
`src/Pulse.WebApi.Tests/ProviderLiveConfigTests.cs` (update the two recorded p95 constants only),
`docs/features/engine-generation-infra/MEASURED-RESULTS.md` (append the run). No code in `Pulse.WebApi/`
app code, no `Program.cs`, no schema. Needs an operator with an `az login` holding Cognitive Services OpenAI
User on `aif-pulse-uat` (same as the 2026-07-18 run). See implementation.md (story 03).

## Dependencies
engine-generation-infra stories 01/04/05/06 (built); PR #571 (UAT on the live provider); #349 UAT verification
(this run can piggyback on it).

## Tests
- In CI: `ProviderLiveConfigTests` (threshold assertion, `Fake`, no key).
- Out of CI: `dotnet test pulse.slnx -c Release -s eval/live-provider.runsettings --filter FullyQualifiedName~MeasuredCostLatencyTests`
  per PROVIDER-GOVERNANCE §6; result recorded in `MEASURED-RESULTS.md`.
