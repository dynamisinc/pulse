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

| Story | State |
|---|---|
| 01 Provider abstraction + governance | **In progress** (this slice: seam, options, governance gate, Fake provider, DI). |
| 02 Prompt assembly & context | Not started. |
| 03 Untrusted-data isolation boundary | Not started (shares the fiction/injection guard with `engine-eval-harness`). |
| 04 Model tiering & caching | Not started. |
| 05 Degraded-mode fallback (circuit breaker) | Not started (greenfield — attach `Microsoft.Extensions.Http.Resilience` to the adapter's `HttpClient`). |
| 06 Cost/latency spike (measured) | **Blocked** on a live tenant-bounded Foundry endpoint + credentials. |

The `AzureOpenAI` / `ClaudeFoundry` adapters pass the governance gate but intentionally throw
"adapter not wired yet" until stories 02/04 + the story-06 measured pass land.
