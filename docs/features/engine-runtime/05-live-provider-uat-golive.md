# Story: Live provider UAT go-live — Azure OpenAI, Ambient tier, suggest-only  `[backend]` `[TIER-2]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend/infra  ·  **Status:** Not Started
**Requirements:** NFR-005, ADP-025 (NFR-003, ADP-024)  ·  **Design decisions:** none  ·  **Issue:** #349

> **⚠ TIER-2 — NFR-005 LLM data governance. Nothing egresses before a human signs `PROVIDER-GOVERNANCE.md` §8.**
> This story makes UAT the **first environment where the engine actually calls a live model** instead of
> `FakeGenerationProvider`. CI and production stay on `Fake` — the fail-closed startup gate
> (`engine-runtime/04`, unchanged here) is the mechanical guarantee behind that; this story adds a second,
> UAT-local guarantee: **standing up the governed endpoint (`ai.bicep`) is decoupled from actually routing
> generation traffic to it.** Only the latter is gated on the Tier-2 sign-off. Reconciles
> `engine-runtime/04` (#288, Complete) — the provider layer, adapters, governance gate, resilience
> pipeline, and `EngineEval` harness are built and unchanged; this story lands the **live deploy +
> verification**, not new provider code.

## Context

`engine-runtime/04` (#288) shipped everything the engine needs to run against a real model: the provider
abstraction, `AzureOpenAIGenerationProvider`, `GenerationGovernance.Validate` (fails closed on
ungoverned config), the Polly resilience/circuit-breaker, and the `EngineEval` release-gating suites.
A **live measured pass already ran** on 2026-07-18 against a real Foundry endpoint (`aif-pulse-uat`) —
see [`../engine-generation-infra/MEASURED-RESULTS.md`](../engine-generation-infra/MEASURED-RESULTS.md):

| Tier | Model | measured p50 | measured p95 | ~$/burst | ~$/exercise-hr |
|---|---|---|---|---|---|
| Standard | gpt-5.4 | 2433 ms | 2655 ms | $0.0056 | ~$2.09 |
| Ambient | gpt-5.4-mini | 1682 ms | 1983 ms | $0.0016 | ~$0.61 |

Both tiers passed `InjectionRedTeam` and `VoiceDiversityRegression` 10/10. The per-attempt timeout was
lowered 30s → 10s from that data (the §3.5 degraded-mode trip point, ≈3.7× measured Standard p95).

Despite that, everything the user actually sees today is `FakeGenerationProvider` canned lines:
committed UAT config is `"Generation": { "Provider": "Fake" }` (`src/Pulse.WebApi/appsettings.json`) and
`infrastructure/parameters/uat.bicepparam` carries `deployAi = false` (`main.bicep`'s default, line 48)
— the July measured pass used a **direct, uncommitted** `az deployment group create` against
`modules/ai.bicep` (the same pattern documented for the Claude side-by-side in
`infrastructure/README.md`), not the checked-in IaC path. This story makes the live provider a real,
committed, repeatable UAT deployment instead of a one-off spike.

**Two loose ends this story closes:**

1. **`backendPrincipalId` was never wired** (`infrastructure/README.md:169`) — `ai.bicep`'s role
   assignment (`Cognitive Services OpenAI User`) is skipped whenever `backendPrincipalId` is empty, and
   `main.bicep`'s `ai` module call hardcodes `backendPrincipalId: ''` (line 328). The July run
   authenticated as a **developer `az login`** (`AzureCliCredential`), not the App Service. **The gap is
   one level deeper than that one line:** `webapp.bicep`'s `webApp` resource has **no `identity` block at
   all** today (no `SystemAssigned` managed identity, no `principalId` output) — so wiring
   `backendPrincipalId` through requires giving the App Service an identity first, not just passing an
   already-existing output through. See Technical Notes for the wiring shape (including why `webApp` must
   *not* gain a reverse dependency on `ai`'s outputs).
2. **The Tier-2 sign-off is unsigned.** `docs/features/engine-runtime/PROVIDER-GOVERNANCE.md` §8 is five
   empty checkboxes, no signer, no date. Both the mechanical fail-closed gate *and* this contractual
   sign-off must hold before `Generation:Provider` is flipped off `Fake` anywhere real traffic can reach
   it — that is this doc's own stated rule, and this story does not relax it.

**Decisions carried into this story as given (not re-litigated here):**

- **Provider: Azure OpenAI in-tenant. Environment: UAT only.** CI/prod stay `Fake`. Claude-on-Foundry
  stays the quality-preferred, unmeasured alternative (`PROVIDER-COMPARISON.md`'s Claude column is still
  empty) — `deployClaude` stays `false` for this story.
- **Autonomy posture for the first live run: suggest-only.** Every AI draft needs a human approve before
  it reaches participants. A concurrent `autonomy-safety` story is adding the runtime lever to flip to
  Delayed-auto; that lever does not exist yet, so suggest-only is in fact the *only* reachable posture
  today — this story does not build or block on that lever, just references it as dependency-adjacent.
- **Model tier for the first live run: Ambient (`gpt-5.4-mini`)** — ~3x cheaper than Standard, and it
  cleared the same 10/10 guard + voice-diversity gates. The reaction loop's generate stage has no runtime
  tier selector today (that is the concurrent `autonomy-safety` story's lever), so this story achieves
  Ambient by pointing the **Standard** config key at the Ambient deployment/model — an **explicitly
  temporary** shim, named and tracked for removal below, not left to become permanent by silence.
- **Known, accepted sharp edge (not solved here):** engine state (loop registration, storylines,
  autonomy) lives in **process memory** — no `Storyline` entity exists in
  `src/Pulse.WebApi/Data/Entities/` (`engine-content-seed/feature.md` "Storyline persistence —
  deliberately deferred"). An App Service restart de-registers the loop; the operational answer is
  re-calling `POST /api/ops/seed-engine-content`. This story's UAT verification pass may need that call;
  it does not change that limitation.

See [`feature.md`](feature.md) and [`implementation.md`](implementation.md) for how this slots into the
B3 wave plan, and [`PROVIDER-GOVERNANCE.md`](PROVIDER-GOVERNANCE.md) for the sign-off table this story
populates.

## Acceptance Criteria

- [ ] **`ai.bicep` activated for UAT via committed IaC (no egress risk by itself).** Given
  `infrastructure/parameters/uat.bicepparam` with `deployAi = true` (`deployClaude` stays `false` — Azure
  OpenAI is the v1 default), When the Deploy Infrastructure workflow runs, Then `aif-pulse-uat`'s Standard
  (`gpt-5.4`) and Ambient (`gpt-5.4-mini`) deployments exist in `rg-pulse-uat-centralus`, idempotently
  (re-running the deploy does not fail or duplicate); standing the endpoint up does **not**, by itself,
  make it reachable from application code — `Generation:Provider` is untouched by this AC.
- [ ] **The `backendPrincipalId` gap is closed.** Given `webapp.bicep`'s App Service resource has no
  identity today, When it is given a system-assigned managed identity + a `principalId` output, and
  `main.bicep`'s `ai` module call is wired `backendPrincipalId: deployWebApp ? webApp.outputs.principalId! : ''`
  (a one-directional dependency — `ai` depends on `webApp`'s identity; `webApp` must **not** gain a
  reverse dependency on `ai`'s outputs, see Technical Notes), Then the deployed
  `app-pulse-api-uat-dynamis` holds the `Cognitive Services OpenAI User` role on `aif-pulse-uat` and can
  authenticate via `DefaultAzureCredential` with **no API key and no developer `az login` credential** in
  the runtime path.
- [ ] **`Generation:*` config mapped verbatim and staged, decoupled from the live-traffic flip.** Given
  the `ai.bicep` outputs and `PROVIDER-GOVERNANCE.md` §4's mapping table, When the UAT App Service
  settings are authored, Then every `Generation:*` key (`Endpoint`, the tier `Deployment`/`Model` pairs,
  `Governance:Residency/TenantBounded/NoTrainingAttested/Retention`) matches its bicep output or
  attestation verbatim (the same discipline B0 used for `webapp`/`database`/`appinsights.bicep`) — and a
  distinct, explicit toggle (independent of `deployAi`) gates whether `Generation__Provider` actually
  resolves to `AzureOpenAI` vs `Fake` on the live App Service, so provisioning the endpoint (AC1) and
  routing traffic to it are two separately-flippable decisions.
- [ ] **Ambient tier for the first live run, via a named, tracked, temporary shim.** Given the loop's
  generate stage only ever reads the "Standard" tier config key and the runtime tier lever does not exist
  yet, When the staged config is authored, Then `Generation:Tiers:Standard:Deployment`/`Model` are
  pointed at the Ambient deployment (`ambient` / `gpt-5.4-mini`) with an inline `TEMPORARY` marker naming
  the story that removes it (the concurrent `autonomy-safety` runtime-tier lever), and that removal is
  recorded as an open follow-up in this feature's `feature.md` — not left silent.
- [ ] **Tier-2 sign-off evidence gathered and presented — the blocking gate.** Given
  `PROVIDER-GOVERNANCE.md` §8's five unchecked items, When AC1–AC4's prep work is done, Then the four
  pieces of evidence are compiled and attached to §8: (i) the governance contract of §2 (tenant-bounded,
  no-training, `DataZoneStandard` residency, `Retention: Retained` pending ZDR approval); (ii)
  `ProviderLiveConfigTests` green in CI (the fail-closed gate, unmodified by this story); (iii) the
  measured p95 (2655ms Standard / 1983ms Ambient) against the 10s degraded-mode trip threshold — both
  comfortably under; (iv) the 2026-07-18 `InjectionRedTeam` live-provider result (10/10 both tiers) — and
  **`Generation:Provider` is not applied as `AzureOpenAI` on the live UAT App Service, and no traffic
  reaches the endpoint, until the user has ticked the boxes and entered signer + date.**
- [ ] **Post-signature: real end-to-end verification in UAT (the actual Definition of Done).** Given the
  sign-off in the prior AC is complete, When the live-traffic toggle is flipped and the engine is
  exercised in UAT (re-registering the loop via `POST /api/ops/seed-engine-content` if the App Service has
  restarted since), Then an AI-authored draft generated by the **Ambient** model appears in the
  controller's review cockpit, a controller approves it (suggest-only — no auto-send, no escalation of
  autonomy by the system itself), and the resulting post reaches the participant social feed in UAT — not
  a unit-test-green claim, an observed, real round trip.
- [ ] **The fail-closed gate and the CI/prod boundary hold, unmodified.** Given this story's UAT-only
  config change, When `ProviderLiveConfigTests` and `AddEngineGenerationTests` run in CI (no key, no
  `-s eval/live-provider.runsettings`), Then they stay green exactly as `engine-runtime/04` left them —
  `Fake` remains the CI/prod default, and a real provider configured without a complete governance posture
  still throws `GenerationConfigurationException` at startup in any environment, including UAT.

## Out of Scope

- **New provider code.** The provider abstraction, adapters, prompt assembly, model tiering, and
  resilience pipeline are built (`engine-generation-infra` #142–147, `engine-runtime/04` #288). This story
  is deploy + config + verification only.
- **The runtime autonomy/tier lever itself** (per-exercise Suggest → Delayed-auto, and a real tier
  selector). Owned by the concurrent `autonomy-safety` story. This story's Standard→Ambient config alias
  is a **named, temporary stopgap** to reach Ambient before that lever exists — not a substitute for it.
- **Delayed-auto or Auto mode for this go-live.** Suggest-only only; it is also the only posture currently
  reachable.
- **Claude-on-Foundry as the default, or provisioned for UAT.** `deployClaude` stays `false`; the Claude
  column in `PROVIDER-COMPARISON.md` stays unmeasured. Azure OpenAI in-tenant is the v1 default per the
  user's decision.
- **Storyline persistence across restarts.** Known, accepted Phase-1/2 limitation
  (`engine-content-seed/feature.md`) — a restart empties `IReactionLoopRegistry` and discards in-memory
  storyline progress; the operational answer is re-calling the seed endpoint. Not solved here.
- **Production go-live.** This story is UAT-scoped; a prod live-provider go-live is a separate, later
  decision with its own sign-off.
- **Azure Gov / StateRAMP endpoints** (NFR-006 roadmap) — commercial Azure at launch, unchanged from
  `engine-runtime/04`.
- **Automated per-customer provider selection.** Still manual, data-driven config.

## Technical Notes

Backend/infra — staff-world connective tissue, no participant-visible surface change (the two-worlds
guarantee is unchanged: engine posts still publish as ordinary posts through `PostIngestService`, origin
still projected out on read). No UI. Relevant paths:

- `infrastructure/modules/ai.bicep` — already authored; this story supplies `backendPrincipalId` from the
  App Service identity (currently hardcoded `''` in `main.bicep` line 328) and provisions via
  `uat.bicepparam`'s `deployAi = true` rather than a manual out-of-band deploy.
- `infrastructure/modules/webapp.bicep` — needs a system-assigned identity on the `webApp` resource
  (`identity: { type: 'SystemAssigned' }`) and a `principalId` output; and the new `Generation__*`
  app-setting entries in its `appSettings` array (same `concat([...], ...)` pattern already used for
  `staffAccountSettings`).
- `infrastructure/main.bicep` — wires `ai`'s `backendPrincipalId` param from `webApp.outputs.principalId!`
  (guarded by `deployWebApp`, matching the existing `#disable-next-line BCP318` convention used for every
  other cross-module output access in this file); and passes the `Generation:*` values into `webApp`'s new
  params.
- `infrastructure/parameters/uat.bicepparam` — `deployAi = true`; a new, separate boolean (e.g.
  `generationProviderLive`, off by default) is the literal live-traffic gate — **do not conflate it with
  `deployAi`**, or standing up the Foundry account would itself flip live traffic on pre-signature.
- `.github/workflows/deploy-infrastructure.yml` — no new secrets are required for the `Generation:*`
  values themselves (they are plain, non-secret config — the endpoint/model/residency are all
  deterministic from already-known names, and auth is keyless `DefaultAzureCredential`); the only
  operator-controlled input is the `generationProviderLive` toggle, which should require an explicit,
  reviewed parameter-file change (mirroring how `deployAi` itself is flipped) rather than an
  always-on default.

**A genuine wiring hazard to avoid: no circular module dependency.** `ai` needs `webApp`'s
`principalId` (a real, ARM-assigned value, only known post-deploy — a true one-directional dependency).
But `webApp`'s `Generation:*` app settings do **not** need to reference `ai`'s outputs at all: the
endpoint (`https://aif-pulse-uat.cognitiveservices.azure.com/`), the model/deployment names, and the
residency are all **deterministic strings computable from the same params both modules already take**
(the AI Foundry account name pattern, `location`, the literal model names). Compute them once as
`main.bicep` locals and pass the *same* literal values into both the `ai` module and `webApp`'s new
`Generation:*` params, independently — do **not** make `webApp` depend on `module ai`'s outputs, or the
two modules form a cycle (`ai` → `webApp` for the identity, `webApp` → `ai` for the config) that Bicep
will reject.

**Reuse, do not reinvent** (`implementation.md`): `AddEngineGeneration`, `GenerationGovernance.Validate`,
`AzureOpenAIGenerationProvider`, `DefaultAzureCredential`, the `EngineEval` suites
(`VoiceDiversityRegression`, `InjectionRedTeam`, the latency/cost SLO), `ProviderLiveConfigTests`. None of
these are modified by this story — only the deployment surface and the values fed into them.

**Cost visibility.** At the measured Ambient rate, a live, registered-but-idle UAT loop runs roughly
**$0.61/exercise-hour** while a storyline is active — cheap, not free. Leaving the live-traffic toggle on
indefinitely after a verification pass is a standing cost, however small; note it in the runbook rather
than assuming "it's cheap" means "leave it on."

## Dependencies

- **Delivered:** `engine-generation-infra` (#142–147 — provider layer, governance gate, resilience);
  `engine-runtime/04` (#288, Complete — the fail-closed gate + the `Generation:*`/bicep-output mapping
  this story applies verbatim); `engine-content-seed` (#324–328, Complete — the persona cast, canned
  storyline, and `POST /api/ops/seed-engine-content` registration this story's UAT verification pass
  exercises); Phase B0/B1/B2 (host, persistence, isolation, publish path, identity/sessions — all merged).
- **Dependency-adjacent, not blocking:** the concurrent `autonomy-safety` story adding the runtime
  Suggest→Delayed-auto + tier lever. This story's Ambient pinning and suggest-only posture are correct
  and sufficient without it; remove the temporary Standard→Ambient alias once that lever lands.
- **Human, out-of-band:** the Tier-2 sign-off (`PROVIDER-GOVERNANCE.md` §8) — a person, not a builder,
  ticks the boxes and dates it. This story cannot complete its "live traffic + verified in UAT" ACs
  without that signature existing first.

## Tests

- **CI (unchanged, reused):** `Pulse.WebApi.Tests/ProviderLiveConfigTests.cs`,
  `Pulse.Core.Tests/.../AddEngineGenerationTests.cs` — stay green with no key; `Fake` remains the CI
  default. No new CI test is added by this story; it changes deployment surface, not provider logic.
- **Out-of-CI live pass (already run, referenced not re-authored):** `LiveInjectionRedTeamTests`,
  `MeasuredCostLatencyTests`, `ProviderComparisonTests` (`eval/live-provider.runsettings`,
  `PULSE_LIVE_FOUNDRY=1`) — the 2026-07-18 results in `MEASURED-RESULTS.md` are the evidence attached to
  the §8 sign-off; re-run only if UAT config drifts from what was measured against.
- **Manual UAT verification (post sign-off — the AC6 check, no automated harness exists for this yet):**
  confirm the loop is registered (re-call `POST /api/ops/seed-engine-content` if needed) → wait for a
  generated burst → confirm an `EngineReviewItem` appears via the controller cockpit / `GET
  /api/engine/review` → approve it → confirm the resulting post appears in `GET /api/feed` / the
  participant social UI. Record the observed timestamps and post content as the completion evidence for
  AC6 (screenshot or logged transcript, attached to the story/issue on completion).
