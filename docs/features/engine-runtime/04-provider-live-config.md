# Story: Provider live-config — governed Azure OpenAI + measured eval  `[backend]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** Not Started
**Requirements:** NFR-005, ADP-025 (NFR-003, ADP-024, NFR-002 / open Q3)  ·  **Design decisions:** none  ·  **Issue:** #288

> **⚠ TIER-2 — NFR-005 LLM data governance.** This story makes a **live**, egressing LLM endpoint
> reachable. The governance contract (tenant-bounded · contractual no-training · documented residency ·
> ZDR as a config target) takes a **human sign-off** on top of the agent review, and the config must
> **fail closed** so a misconfigured deployment can never reach a public/untenanted endpoint.
>
> **Reconciles `engine-generation-infra` (#142–147).** The provider abstraction, the Azure OpenAI /
> Claude-Foundry adapters, `GenerationGovernance`, the Polly resilience/circuit-breaker, and the
> `EngineEval` harness are all built. This story lands the **live config** and replaces the *modeled*
> cost/latency with *measured*; it does not rebuild the provider layer.

## Context
`engine-generation-infra` shipped the provider abstraction with three providers — `FakeGenerationProvider`
(the default), `AzureOpenAIGenerationProvider`, `ClaudeFoundryGenerationProvider` — behind
`IGenerationProvider`, config-selected by `AddEngineGeneration` (`Generation:Provider`), with the
NFR-005 `GenerationGovernance.Validate` gate running **before** any HttpClient is built. But the
cost/latency envelope (E8 arch §4) is **modeled, not measured** — "no API key was available in this
environment, so latency and live voice quality are modeled" (§4.1 caveat) — and the live endpoint
(`ai.bicep`, Azure AI Foundry / Azure OpenAI) is dormant/gated-off.

This story lands Azure OpenAI in-tenant as the **v1 default** live provider (tenant-bounded, no-training,
documented residency, ZDR as a config target) via `ai.bicep`, makes `AddEngineGeneration` select it and
**fail closed** if the governance keys are unset, then runs the built `EngineEval` harness against the
**live** provider to: replace the §4 *modeled* cost/latency with *measured*; validate the §3.5 ~p95 10s
degraded-mode trip threshold against measured p95; and keep the ADP-024 injection red-team **green**
against the live provider. Backend/staff — no participant surface. See `feature.md` and `implementation.md`.

## Acceptance Criteria
- [ ] **Live provider selection.** Given `Generation:Provider = AzureOpenAI` (or `ClaudeFoundry`) with a
  governed endpoint configured, When the host starts, Then `AddEngineGeneration` selects the live
  provider behind `IGenerationProvider`; `Fake` remains the default for CI/tests.
- [ ] **Fail closed on ungoverned config (NFR-005 — Tier-2).** Given a real provider is configured but
  the governance keys (tenant-bounded endpoint / no-training / documented residency) are unset or
  invalid, When the host starts, Then `GenerationGovernance.Validate` throws and the host **fails fast
  at startup** — it never constructs an HttpClient or reaches a public/untenanted endpoint (no accidental
  ungoverned egress).
- [ ] **`ai.bicep` activation.** Given the dormant `infrastructure/modules/ai.bicep` (designed to stand
  up independently), When it is enabled, Then it provisions the live Azure AI Foundry / Azure OpenAI
  endpoint and the `Generation:*` config keys match the bicep outputs verbatim.
- [ ] **Measured cost/latency replaces modeled.** Given the live provider, When the `EngineEval`
  latency/cost SLO suite runs, Then the E8 §4 *modeled* numbers are replaced with *measured* p50/p95
  latency and per-burst cost per provider/model, recorded so estimates can lock.
- [ ] **Degraded-mode threshold validated (NFR-003).** Given measured p95, When compared to the §3.5
  ~p95 10s degraded-mode trip threshold, Then the circuit-breaker config (`Resilience.AttemptTimeout` /
  failure ratio in `AddEngineGeneration`) is tuned to the measurement; if measured p95 approaches the
  threshold, it is flagged rather than silently accepted.
- [ ] **Injection red-team green against the live provider (ADP-024).** Given the `EngineEval.InjectionRedTeam`
  suite, When it runs against the **live** provider (not only `Fake`), Then it stays **green** — a
  regression blocks release (§12.2); the four-layer isolation boundary (`WorldFeedFence` +
  system-prompt framing + `emit_posts` tool shape + `ContentGuard`) holds against a live model.
- [ ] **LLM governance (NFR-005 / ADP-025) — Tier-2.** The endpoint is tenant-bounded with contractual
  no-training terms and documented residency; ZDR is a config target; participant/world content is
  untrusted data, never instructions (prompt-injection isolation). The governance posture is documented
  and human-signed-off before the live endpoint is reachable.

## Out of Scope
- **The provider abstraction, adapters, prompt assembly, model tiering, and the resilience pipeline**
  (built — `engine-generation-infra` #142–147). This story is live config + measured eval only.
- **Auto mode (v1.1).** The provider serves Suggest + Delayed-auto generation.
- **Automated per-customer approved-provider selection.** Provider choice is manual, data-driven config
  this phase (the eval numbers + the customer's approved list decide); no auto-negotiation.
- **Azure Gov / StateRAMP endpoints** (NFR-006 roadmap) — commercial Azure at launch.
- **Claude-on-Foundry as the default.** Azure OpenAI in-tenant is the v1 default (cleanest residency,
  lowest procurement friction); Claude via a tenant-bounded endpoint is the quality-preferred
  *alternative*, selectable per deployment — the eval decides, not preference.

## Technical Notes
Backend / staff world — no participant skin, no COBRA (no UI). Owns the **live-config surface**: the
`infrastructure/modules/ai.bicep` activation (params / deploy toggle — the orchestrator flips the
`deployAi` toggle), the `Generation:*` `appsettings` keys, and the `EngineEval` run configuration
against the live provider. It does **not** author new provider code.

**Reuse, do not reinvent** (see `implementation.md`): `AddEngineGeneration` (config-selects the
provider; `AddHttpProvider<T>` runs `GenerationGovernance.Validate` first), `GenerationGovernance.Validate`,
`AzureOpenAIGenerationProvider` / `ClaudeFoundryGenerationProvider`, the Polly retry + circuit-breaker +
per-attempt timeout in `AddHttpProvider` (which already raises the degraded-mode signal via
`IProviderHealthListener` on trip), keyless auth (`DefaultAzureCredential`), and the `EngineEval` suites
(`VoiceDiversityRegression`, `InjectionRedTeam`, and the latency/cost SLO). Config keys must match
`ai.bicep` verbatim (the same discipline B0 followed for `webapp`/`database`/`appinsights.bicep`).

**Tier-2:** the governance contract is the always-Critical, human-sign-off class (mirrors B0's #269/#44
Tier-2 handling). The fail-closed startup gate is the mechanical guarantee behind the sign-off.

## Dependencies
- **Delivered:** `engine-generation-infra` (#142–147 — the provider layer, governance gate, resilience);
  `engine-eval-harness` (the §12 suites this runs against the live provider); Phase B0 (`backend-host/01`
  host + `AddEngineGeneration` already called in `Program.cs`).
- **Infra:** `infrastructure/modules/ai.bicep` (dormant, "designed to stand up independently" — a cheap
  early move to give the engine runtime a real provider endpoint).
- **Foundation for (same feature):** story 01 (the loop's generate stage runs against `IGenerationProvider`
  — Fake in CI, this live provider in a governed deployment). Wave 1, file-disjoint from story 03.

## Tests
`EngineEval` run against the live provider (release-gating): `InjectionRedTeam` green; the latency/cost
SLO suite records measured p50/p95 + per-burst cost, replacing the modeled §4 numbers; measured p95
checked against the §3.5 trip threshold. xUnit: `AddEngineGeneration` fails fast (throws
`GenerationConfigurationException` / governance error) when a real provider is configured without the
governance keys — the fail-closed gate; `Fake` stays selected with no `Generation:Provider` set.
Governance posture documented for the Tier-2 sign-off.
