# Provider governance posture — Tier-2 sign-off (engine-runtime/04)

> **Requirement:** NFR-005 / ADP-025 (LLM data governance). **Story:** #288 — *Provider live-config*.
> **Class:** **Tier-2** — this is the human sign-off that gates making a **live, egressing** LLM endpoint
> reachable, on top of the agent review. The fail-closed startup gate (below) is the *mechanical* guarantee
> behind this *contractual* sign-off; both must hold before `Generation:Provider` is flipped off `Fake`.

## 1. What this story changes (and does not)

This story lands the **live-config surface** only. The provider abstraction, the Azure OpenAI /
Claude-on-Foundry adapters, `GenerationGovernance.Validate`, the Polly resilience/circuit-breaker, and the
`EngineEval` harness were built by `engine-generation-infra` (#142–147) and are **not** modified here. This
story delivers:

- **`infrastructure/modules/ai.bicep`** — the governed Azure AI Foundry / Azure OpenAI endpoint (already
  authored, dormant behind `deployAi`). This story adds the outputs (`standardModelName`, `ambientModelName`,
  `residency`) so every governed `Generation:*` value has a bicep output to source from verbatim.
- **`Generation:*` config keys** — the committed default stays `Provider=Fake` in
  `src/Pulse.WebApi/appsettings.json` (CI/tests never egress); the governed example is
  `src/Pulse.WebApi/appsettings.Generation.Example.json` (a **non-loaded** reference — ASP.NET Core only
  auto-loads `appsettings.json` + `appsettings.{Environment}.json`).
- **The out-of-CI live-provider eval run configuration** — `eval/live-provider.runsettings`.
- **This governance-posture doc** + the CI fail-closed gate (`ProviderLiveConfigTests`).

The `Generation:Provider` `Fake → AzureOpenAI` flip itself is **orchestrator-owned** (composition root); no
builder makes a live endpoint reachable unilaterally.

## 2. The governance contract (NFR-005 / ADP-025) — what a signer attests

The default live provider is **Azure OpenAI in-tenant** (`gpt-5.4` / `gpt-5.4-mini` on `aif-pulse-uat`).
Claude-on-Foundry is the quality-preferred, per-deployment alternative (same governance gate). Before the
endpoint is reachable, the signer confirms each of the following — each is also a machine-enforced
`GenerationGovernance.Validate` gate (see §3):

| Posture (NFR-005) | How it is met | Config gate |
|---|---|---|
| **Tenant-bounded** | `aif-pulse-uat` is a single-tenant Cognitive Services account; `disableLocalAuth: true` (keyless Entra / managed identity — no API key exists to leak); no shared/public inference. | `Generation:Governance:TenantBounded = true` |
| **Contractual no-training** | Azure OpenAI Service does not use customer prompts/completions to train models (Microsoft product terms); ditto Anthropic-in-Azure via the Marketplace offer. | `Generation:Governance:NoTrainingAttested = true` |
| **Documented residency** | Model deployments use the `DataZoneStandard` SKU (US data zone); the deployment region is the documented residency. | `Generation:Governance:Residency = <region>` (= `ai.bicep` `residency` output) |
| **Zero data retention (config target)** | ZDR is the **target** posture; it requires the Azure "modified content filtering / abuse-monitoring off" approval per subscription. Until that approval lands, the attestable posture is `Retained` (standard retention under the no-training contract) — set explicitly, never left `Unspecified`. Every tier model must be `ZdrCapable` before ZDR is selected. | `Generation:Governance:Retention = ZeroDataRetention` (target) or `Retained` (today) |
| **Untrusted world content** | Participant/world content is untrusted **data**, never instructions — the four-layer prompt-injection isolation (`WorldFeedFence` + system-prompt framing + `emit_posts` tool shape + `ContentGuard`) is release-gated by `InjectionRedTeam` against the live provider (§5, ADP-024). | enforced in-adapter (built) |

## 3. The mechanical guarantee — fail closed at startup

`AddEngineGeneration` runs `GenerationGovernance.Validate` **before** any adapter or `HttpClient` is
constructed. A real (egressing) provider configured without a complete governance posture — not
tenant-bounded, no no-training attestation, no documented residency, or an `Unspecified` retention stance —
throws `GenerationConfigurationException` and the host **fails fast at startup**. It never reaches a
public/untenanted endpoint. This is the load-bearing behaviour behind the Tier-2 sign-off; it is covered by
`ProviderLiveConfigTests` (CI, no key required) and `AddEngineGenerationTests` (Pulse.Core.Tests).

`Fake` (the committed default) is compliant by construction — in-process, no egress, nothing to attest.

## 4. Config-key → bicep-output mapping (verbatim)

The governed deployment sources every `Generation:*` value verbatim from `infrastructure/modules/ai.bicep`
outputs (supplied as `Generation__*` env vars by the orchestrator; the same discipline B0 used for
`webapp`/`database`/`appinsights.bicep`):

| `Generation:*` key | `ai.bicep` output | Example value |
|---|---|---|
| `Generation:Endpoint` | `endpoint` | `https://aif-pulse-uat.cognitiveservices.azure.com/` |
| `Generation:Tiers:Standard:Deployment` | `standardDeploymentName` | `standard` |
| `Generation:Tiers:Standard:Model` | `standardModelName` | `gpt-5.4` |
| `Generation:Tiers:Ambient:Deployment` | `ambientDeploymentName` | `ambient` |
| `Generation:Tiers:Ambient:Model` | `ambientModelName` | `gpt-5.4-mini` |
| `Generation:Governance:Residency` | `residency` | `centralus` |
| `Generation:ApiVersion` | _(client data-plane choice, not provisioned)_ | `2025-04-01-preview` |

For the Claude-on-Foundry alternative, set `Generation:Provider = ClaudeFoundry` and
`Generation:Endpoint` from the `claudeEndpoint` output (native Anthropic passthrough).

## 5. Measured cost/latency + the degraded-mode threshold (NFR-003)

The E8 §4 **modeled** cost/latency is replaced by **measured** numbers — recorded 2026-07-18 against
`aif-pulse-uat` in [`../engine-generation-infra/MEASURED-RESULTS.md`](../engine-generation-infra/MEASURED-RESULTS.md)
(and the provider side-by-side in `PROVIDER-COMPARISON.md`):

| Tier | Model | measured p50 | measured p95 | ~$/burst | ~$/exercise-hr |
|---|---|---|---|---|---|
| Standard | gpt-5.4 | 2433 ms | **2655 ms** | $0.0056 | ~$2.09 |
| Ambient | gpt-5.4-mini | 1682 ms | **1983 ms** | $0.0016 | ~$0.61 |

- **Degraded-mode trip threshold (NFR-003):** `Resilience.AttemptTimeoutSeconds = 10` — the §3.5 ~10s breach
  point, ≈3.7× the measured Standard p95. A call slower than this is cancelled and feeds the circuit breaker
  (which lowers autonomy — only ever down, §8.2). `ProviderLiveConfigTests.GovernedExample_TripThreshold_*`
  asserts the configured threshold against the measured p95 and **fails (flags) if p95 approaches it** rather
  than silently accepting it. Re-run the live pass and re-tune if a future measurement approaches ~7s.
- **Cost is not the differentiator** — ~$0.6–2.3/exercise-hour tiered, immaterial next to the SimCell
  staffing the engine offsets. The default-provider choice turns on measured voice fidelity + the customer's
  approved-provider list (`PROVIDER-COMPARISON.md`).

## 6. Running the live-provider eval pass (out-of-CI)

CI never runs this — it has no key and stays on `Fake`. To run against the live governed endpoint:

```bash
# 1. deployAi=true (orchestrator flips the toggle) has provisioned aif-pulse-uat.
# 2. Grant your az-cli login the data-plane role once (keyless Entra; see infrastructure/README.md):
az role assignment create --role "Cognitive Services OpenAI User" \
  --assignee <your-object-id> \
  --scope $(az cognitiveservices account show -n aif-pulse-uat -g rg-pulse-uat-centralus --query id -o tsv)

# 3. Run the keyed pass (the .runsettings sets PULSE_LIVE_FOUNDRY=1; CI never passes -s):
dotnet test pulse.slnx -c Release -s eval/live-provider.runsettings \
  --filter "FullyQualifiedName~LiveInjectionRedTeamTests|FullyQualifiedName~LiveFoundryTests|FullyQualifiedName~MeasuredCostLatencyTests|FullyQualifiedName~ProviderComparisonTests"
```

- **`LiveInjectionRedTeamTests`** — the built `InjectionRedTeam.Catalog` against the **live** model; every
  attack must stay guard-clean (ADP-024, §12.2 — a regression blocks release).
- **`LiveFoundryTests` / `MeasuredCostLatencyTests` / `ProviderComparisonTests`** — the built generate/guard/
  diversity path, the measured latency/cost SLO suite, and the Azure-OpenAI-vs-Claude comparison.

Record the measured output back into `MEASURED-RESULTS.md` / `PROVIDER-COMPARISON.md` so the estimates lock.

### When to re-run (the triggers that invalidate §8 evidence (iv))

Re-run this pass — and refresh the §8 evidence — whenever the deployed configuration drifts from what
was measured on 2026-07-18:

- **Model *version* drift (the one that moves on its own).** `ai.bicep` sets
  `versionUpgradeOption: 'OnceNewDefaultVersionAvailable'` on both deployments, so the Ambient
  deployment can auto-upgrade off the measured `gpt-5.4-mini` `2026-03-17` build without any repo
  change. Evidence (iv) is therefore strong on the deployment name and model *id*, and only
  **point-in-time** on the version. Before signing (and periodically after), check the live version and
  re-run if it has moved:
  ```bash
  az cognitiveservices account deployment show -n aif-pulse-uat -g rg-pulse-uat-centralus \
    --deployment-name ambient --query "properties.model.{name:name, version:version}" -o json
  # Expect version 2026-03-17 (the measured build). A different version = re-run §6 before relying on (iv).
  ```
  Pin `ambientModelVersion` / `standardModelVersion` (or set `versionUpgradeOption: 'NoAutoUpgrade'`) if
  a deployment must stay bit-identical to a measured run.
- **Endpoint, api-version, deployment/model id, or SKU/residency changes** — any edit to the
  `Generation:*` values or `ai.bicep`'s model params.
- **Prompt/guard changes** in the assembly or `ContentGuard`/`InjectionRedTeam` path (ADP-024 — a
  regression blocks release).

## 7. Out of scope (per the story)

Azure Gov / StateRAMP endpoints (NFR-006 roadmap; commercial Azure at launch); Auto mode (v1.1);
automated per-customer provider selection (manual, data-driven config this phase); Claude-on-Foundry as the
default (Azure OpenAI in-tenant is the v1 default; Claude is the per-deployment alternative the eval decides).

## 8. Sign-off

> **Status: UNSIGNED — this is the hard stop.** `engine-runtime/05` has prepared everything below and
> deliberately stopped here. Evidence is compiled and linked so signing is a **one-step human action**;
> nothing in the repo ticks a box. Until the boxes below are ticked and signer + date entered,
> `generationProviderLive` stays `false` and the UAT App Service resolves `Generation:Provider = Fake`.

**Environment requested:** `uat` (`app-pulse-api-uat-dynamis` → `aif-pulse-uat`,
`rg-pulse-uat-centralus`). CI and production are **not** in scope and stay on `Fake`.
**Posture requested:** Ambient tier (`gpt-5.4-mini`, via the temporary Standard→Ambient config alias),
**suggest-only** autonomy — every AI draft needs a human approve before it can reach participants
(it is also the only posture reachable today; the runtime Suggest→Delayed-auto lever is
`autonomy-safety/05`, #353).

### Evidence (compiled by `engine-runtime/05` — verify, don't take on trust)

| # | Item | Evidence | Where to verify |
|---|---|---|---|
| i | **Governance contract** (§2) — tenant-bounded, contractual no-training, documented `DataZoneStandard` residency, retention explicitly `Retained` (ZDR is the target, blocked on the per-subscription abuse-monitoring approval) | **Authored in IaC; pending the `deployAi = true` deploy — see "Deploy ordering" below.** `aif-pulse-uat` is a single-tenant Cognitive Services account with `disableLocalAuth: true` (**no API key exists**) and model deployments on the `DataZoneStandard` SKU in `centralus`. The keyless-identity half is **newly authored and not yet applied**: `webapp.bicep` had **no** `identity` block before `engine-runtime/05` and `deployAi` was `false`, so the 2026-07-18 measured run authenticated as a **developer `az login`** (`AzureCliCredential`) — exactly the gap this story closes. Once deployed, the App Service reaches the account keylessly via its own system-assigned identity holding `Cognitive Services OpenAI User`, with no developer credential in the runtime path | §2 of this doc; `infrastructure/modules/ai.bicep` (`disableLocalAuth`, `modelSkuName`, the role assignments); `infrastructure/modules/webapp.bicep` (`identity`, `principalId` output); `infrastructure/main.bicep` (`backendPrincipalId`, the `Generation:*` locals). **Then verify against Azure** with the commands under "Deploy ordering" |
| ii | **Fail-closed gate green in CI** (§3) — a real provider without a complete governance posture throws `GenerationConfigurationException` at startup, in any environment including UAT; `Fake` stays the committed CI/prod default | `ProviderLiveConfigTests` (5 tests, `Pulse.WebApi.Tests`) + `AddEngineGenerationTests` (`Pulse.Core.Tests`) — unmodified by story 05 and green in the story's Gate-0 run. `CommittedAppsettings_KeepsFakeProvider_SoCiNeverEgresses` pins the committed default; `GovernedExample_WithGovernanceKeyUnset_FailsClosedAtStartup` pins the throw | `dotnet test pulse.slnx` on the story branch / the CI run for its PR |
| iii | **Measured p95 within the degraded-mode threshold** (§5, NFR-003) — **Standard 2655 ms**, **Ambient 1983 ms** against a **10 s** per-attempt trip threshold (Ambient, the tier being flipped live, sits at **20 %** of the threshold) | `MEASURED-RESULTS.md` (run 2026-07-18, `aif-pulse-uat`, keyless, 5 iterations/tier, 4-persona bursts). `ProviderLiveConfigTests.GovernedExample_TripThreshold_IsTunedToMeasuredP95_AndFlagsIfApproaching` re-asserts it every CI run and **fails** if a future p95 climbs past 70 % of the threshold rather than silently accepting it | [`../engine-generation-infra/MEASURED-RESULTS.md`](../engine-generation-infra/MEASURED-RESULTS.md); §5 above |
| iv | **`InjectionRedTeam` green against the live provider** (§6, ADP-024) — **10/10** live bursts guard-clean on **both** tiers, and 10/10 on the voice-diversity gate (ADP-021), including `gpt-5.4-mini` | The 2026-07-18 out-of-CI live pass (`LiveInjectionRedTeamTests` + `MeasuredCostLatencyTests` via `eval/live-provider.runsettings`, `PULSE_LIVE_FOUNDRY=1`). Re-run per §6 **if the UAT config drifts from what was measured** — the config staged for this go-live is the same endpoint, api-version, and Ambient deployment/model id that were measured. **Caveat: the model *version* is not pinned** (`versionUpgradeOption: 'OnceNewDefaultVersionAvailable'`), so this is point-in-time on the version — check it per §6's re-run triggers before signing | `MEASURED-RESULTS.md` findings 1 + 4; §6 → "When to re-run" for the version check + re-run command |

### Deploy ordering — evidence (i) is only confirmable AFTER a deploy, and BEFORE signing

`engine-runtime/05` authored the IaC and ran **no** deployment. So the order is:

1. **Deploy the provisioning half first** (`deployAi = true`, `generationProviderLive` still `false`):
   run **Deploy Infrastructure** — start with `what_if: true` (see the README prerequisite about the
   service principal needing role-assignment write). This is safe: it creates the account, the App
   Service identity, and the role assignment, and routes **no** traffic (`Generation__Provider` stays
   `Fake`).
2. **Confirm evidence (i) against Azure** — the identity exists and actually holds the data-plane role:
   ```bash
   RG=rg-pulse-uat-centralus
   ACCOUNT_ID=$(az cognitiveservices account show -n aif-pulse-uat -g $RG --query id -o tsv)
   # The App Service's system-assigned principal (also emitted as the webAppPrincipalId template output):
   PRINCIPAL_ID=$(az webapp identity show -n app-pulse-api-uat-dynamis -g $RG --query principalId -o tsv)
   az role assignment list --assignee "$PRINCIPAL_ID" --scope "$ACCOUNT_ID" \
     -o table --query "[].{role:roleDefinitionName, scope:scope}"
   # Expect: Cognitive Services OpenAI User at the account scope. Also confirm keyless + residency:
   az cognitiveservices account show -n aif-pulse-uat -g $RG \
     --query "{localAuthDisabled:properties.disableLocalAuth, location:location}" -o json
   ```
3. **Only then sign §8** — the boxes below assert an observed posture, not an authored intent.
4. **Then flip the live-traffic gate** (next paragraph).

**What signing actually authorizes** (the one mechanical change): set `param generationProviderLive = true`
in `infrastructure/parameters/uat.bicepparam` and run **Deploy Infrastructure**. That flips exactly one
App Service setting — `Generation__Provider` `Fake` → `AzureOpenAI`. Everything else (`Endpoint`, the
tier deployment/model pairs, the governance attestations) is already staged and unchanged by the flip;
step 1 above has by then provisioned the endpoint and the role assignment **without** routing any
traffic. See `infrastructure/README.md` → "`Generation:*` app settings and the live-traffic gate" for the
runbook, including the post-flip `POST /api/ops/seed-engine-content` re-registration (an app-setting
change restarts the App Service, and engine loop state is process-memory this phase) and the standing
cost note (~$0.61/exercise-hour on Ambient while a storyline is active — flip it back off after the
verification pass).

| | |
|---|---|
| Governance contract reviewed (§2 — evidence i) | ☐ |
| Fail-closed gate verified (§3 — `ProviderLiveConfigTests` green in CI, evidence ii) | ☐ |
| Measured p95 within the degraded-mode threshold (§5 — evidence iii) | ☐ |
| `InjectionRedTeam` green against the live provider (§6 — evidence iv) | ☐ |
| Approved to flip `Generation:Provider` off `Fake` for `<environment>` — requested: **`uat`**, Ambient tier, suggest-only | ☐ |
| Signer / date | |
