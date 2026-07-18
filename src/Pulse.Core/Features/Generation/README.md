# Feature: Generation (engine generation infrastructure)

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/engine-generation-infra/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §3–§4
**Issue:** #127 (stories #142–#147)

The provider-abstracted generation core the whole engine runs on. Nothing here is participant-visible;
output publishes through the E2 pipeline as an ordinary persona-authored post (SOC-003).

## The seam (story 01 — `IGenerationProvider`)

The reaction loop calls `IGenerationProvider`, **never a vendor SDK directly**, so the concrete
provider is swappable per deployment (the same config-driven pattern as Cadence's Email/Blob providers).

| Type | Role |
|---|---|
| `Services/IGenerationProvider.cs` | The swappable seam: `GenerateAsync(request) → posts + usage + latency`. |
| `Models/GenerationDtos.cs` | Transport records: `GenerationRequest` / `GeneratedPost` / `GenerationResult` / `GenerationUsage`, `GenerationTier`. |
| `Models/GenerationOptions.cs` | `"Generation"` config section: `Provider` discriminator, `Endpoint`, `Governance`, `Tiers`. |
| `Services/GenerationGovernance.cs` | The NFR-005 governance gate + attested posture; `GenerationConfigurationException`. |
| `Services/FakeGenerationProvider.cs` | Deterministic, offline, no-egress provider — the dev/CI default. |
| `Core/Extensions/ServiceCollectionExtensions.cs` | `AddEngineGeneration(config)` — config-driven selection + governance gate. |

## Governance is a startup gate, not a runtime hope (NFR-005 / ADP-025)

`AddEngineGeneration` runs `GenerationGovernance.Validate` for any real (egressing) provider **before**
the adapter is constructed. A provider that is not tenant-bounded, has no no-training attestation, has
no documented residency, or (when the deployment targets ZDR) names a non-ZDR-capable model is rejected
with a clear configuration error. The `Fake` provider never egresses, so it is compliant by construction.

## Trust boundary (ADP-024 — handled in story 03)

`GenerationRequest.SystemPrompt` is **trusted** engine context (assembled by story 02).
`GenerationRequest.WorldFeed` is **untrusted** world/participant content, already fenced/role-tagged by
story 03. The provider transports both; it never re-interprets the boundary.

## Status

All six generation-infra stories have landed on this slice (PR #248), live-validated + measured:

| Story | State |
|---|---|
| 01 Provider abstraction + governance | Done — seam, options, governance gate, Fake provider, DI. |
| 02 Prompt assembly & context | Done — `PromptAssembler` (3-strata, cache-prefix-ordered). |
| 03 Untrusted-data isolation boundary | Done — `WorldFeedFence` + `ContentGuard`/`VoiceMetrics` (shared with `engine-eval-harness`). |
| 04 Model tiering & caching | Done — `TierPolicy`; cache-prefix stability (engages once the prefix exceeds Azure's ~1024-token threshold). |
| 05 Degraded-mode fallback (circuit breaker) | Done — resilience pipeline + `IProviderHealthListener` degraded-mode seam. |
| 06 Cost/latency spike (measured) | Done — live measured pass; see `docs/features/engine-generation-infra/MEASURED-RESULTS.md`. |

The `AzureOpenAI` adapter is wired and live-validated. `ClaudeFoundry` passes the governance gate but
intentionally throws "adapter not wired yet" — the serverless Claude-on-Foundry adapter is a fast-follow.
