# Implementation: Engine generation infrastructure

> The planning→orchestration bridge for the E8 generation core. Backend .NET does not exist yet, so
> these stories define the **provider interface + prompt/isolation contracts**; the frontend cockpit
> that consumes drafts already exists (engine-review-cockpit #34–36). Grounded in the validated
> prototype `spikes/e8-generation-loop/`.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Provider abstraction + governance | `IGenerationProvider` with adapters (Azure OpenAI in-tenant default; Claude via Foundry/Bedrock/Vertex). Governance metadata as config. | `services/generation/IGenerationProvider`, provider adapters, governance config | `IGenerationProvider.generate(request) → {posts, usage, latency}`; the governance contract every provider satisfies |
| 02 Prompt assembly & context | Build the 3-strata request (system trusted / user untrusted-fenced / forced `emit_posts`); assemble storyline state + dossiers + last-K relevant world posts. | `services/generation/promptAssembly`, `emit_posts` schema | `assembleRequest(storyline, personas, worldPosts) → GenerationRequest` |
| 03 Untrusted-data isolation | Fence + role-tag + neutralise the world feed; pre-review guard filter. | `services/generation/worldFeedFence`, pre-review guard wiring | `fenceWorldFeed(posts)`; `guardDraft(draft) → pass/fail` (shared guard from eval-harness) |
| 04 Model tiering & caching | Tier selection input to the provider; cache-control on the stable prefix per provider. | `services/generation/tierPolicy`, cache config | `pickTier(intent) → tier`; cache-key boundary contract (prefix stable) |
| 05 Degraded-mode fallback | Circuit breaker around the provider (error-rate + p95 latency); drops autonomy to Suggest + alerts. | `services/generation/circuitBreaker` | `onTrip → setAutonomy(Suggest) + alert`; "autonomy only moves down" invariant |
| 06 Cost/latency spike | Live-key measurement pass over `spikes/e8-generation-loop/`. | (spike dir; no product files) | measured latency/cost tables → SLO thresholds |

## Reuse map
- **Provider abstraction** — this feature *defines* it (`IGenerationProvider`); all E8 generation goes through it.
- Exercise-context / query-scoping layer (E1) — `<path when it exists>` (exercise-scoped, staff-only).
- Persona dossiers (COR-020) — from `persona-management`; voice notes + style params + prior posts.
- Telemetry emitter (`XC-004` v0 schema) — `<path when it exists>` (usage, cache hits, breaker trips).
- E2 publish pipeline — output path (a persona-authored post; origin hidden, SOC-003).
- Shared fiction/injection guard — co-owned with `engine-eval-harness`; prototyped in `spikes/e8-generation-loop/metrics.mjs`.
- The prototype `spikes/e8-generation-loop/{index.mjs,metrics.mjs}` — reference for prompt shape + metrics.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Provider abstraction | provider interface + adapters + governance config | E1 context layer (backend contract) | — | 1 | M |
| 02 Prompt assembly | promptAssembly, emit_posts schema | 01, persona dossiers, storyline shape | 03 | 2 | M |
| 03 Isolation boundary | worldFeedFence, pre-review guard | 02, shared guard | 02 | 2 | M |
| 04 Model tiering & caching | tierPolicy, cache config | 01, 02 | 05 | 3 | S |
| 05 Degraded-mode fallback | circuitBreaker | 01, autonomy levels (autonomy-safety) | 04 | 3 | S |
| 06 Cost/latency spike | (spike dir only) | 01–04, credentials | — | 4 | S |

Foundation-first: 01 is the seam everything else imports. 02+03 are the prompt+isolation pair.
04+05 are cost/resilience. 06 measures once the pieces exist. The frontend→backend edge is serial
(the backend does not exist yet); the provider interface is the contract seam.
