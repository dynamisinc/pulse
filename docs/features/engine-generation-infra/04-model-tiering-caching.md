# Story: Model tiering & prompt caching

**Feature:** Engine generation infrastructure  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-011 (cost side)  ·  **Design decisions:** none  ·  **Issue:** #145

## Context
The cost envelope (open question 3) is held by two levers proven in the spike (architecture §4.2):
**model tiering** — a Sonnet-tier model for storyline-critical reactions, a Haiku-tier model for
ambient/bulk chatter (the flagship Opus/Fable tiers are unnecessary per-post and Fable is unavailable
under ZDR); and **prompt caching** of the stable dossier+brief+rules prefix (~2,300 tokens), which
bills at ~0.1× as a cache read after the first call — the single biggest cost lever. Both are
provider-agnostic (auto-cache on 1P/Foundry, manual `cache_control` on Bedrock/Vertex, Azure-native
on Azure OpenAI).

## Acceptance Criteria
- [ ] Given a generation request, when the engine selects a model tier, then storyline-critical
      generation uses the Sonnet-tier and ambient/bulk uses the Haiku-tier, per the reaction-loop's
      intent.
- [ ] Given a sequence of bursts sharing the stable prefix, when they run, then the dossier+brief+rules
      prefix is prompt-cached and subsequent calls report cache reads (not full-price re-processing).
- [ ] Given the stable prefix, when it is built, then it is byte-stable across calls (no timestamps /
      per-request IDs in it — scenario time is injected as storyline state per story 02), so the cache
      is not silently invalidated.
- [ ] Given the flagship tiers, when model selection runs, then Opus/Fable are **not** used for
      per-post generation (documented rationale: no reviewer-visible believability gain at 3–10× cost;
      Fable ZDR restriction).
- [ ] Per-burst token usage + cache-hit metrics are emitted (telemetry XC-004) so cost can be tracked
      and tuned (feeds engine-eval-harness story 03).

## Out of Scope
The provider interface (story 01); rate caps / quiet floors (storyline-model story 04 — this story is
about *which model + caching*, not *how often*); the SLO measurement (engine-eval-harness story 03);
batch generation of backdated history (persona-management, latency-insensitive).

## Technical Notes
Staff/backend. Tier selection is an input to the provider request (story 01). Caching config differs
per provider (auto vs manual `cache_control` vs Azure-native) — abstract it behind the provider
interface. Costs computed as in `spikes/e8-generation-loop/metrics.mjs` (`costUSD`, `PRICING`). See
implementation.md (story 04) and architecture §3.2/§4.2.

## Dependencies
Story 01 (provider interface); story 02 (byte-stable prefix); reaction-loop (supplies the intent that
picks the tier); XC-004 emitter.

## Tests
- Unit: storyline-critical → Sonnet-tier, ambient → Haiku-tier.
- Unit: repeated identical-prefix bursts show cache reads > 0; a timestamp injected into the prefix
  breaks caching (guards the byte-stability rule).
