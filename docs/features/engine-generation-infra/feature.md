# Feature: Engine generation infrastructure

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.3 / NFR-005
**World:** staff / backend  ·  **Issue:** #127

## Summary
The provider-abstracted generation service the whole engine runs on: a tenant-bounded, no-training
LLM endpoint behind a swappable provider interface (the pattern of the COR-050 clock provider), the
prompt structure + context assembly that turns storyline state into persona-voiced drafts, the
**prompt-injection isolation boundary** that treats participant content as data-never-instructions
(ADP-024), model tiering + prompt caching for the cost envelope, and the degraded-mode fallback that
drops the engine to Suggest/manual on outage or latency breach. Nothing here is participant-visible;
output publishes through the E2 pipeline as any post (SOC-003).

## Requirements covered
ADP-024 (injection isolation), ADP-025 (generation data governance), NFR-005 (LLM governance),
NFR-003 (degraded modes), plus the cost side of ADP-011 and the epic's cost/latency spike (open
question 3). Consumes COR-020 persona voice notes and the E1 exercise-context layer.

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §3 (generation architecture & provider), §4 (cost/latency
envelope), §3.4 (four-layer isolation boundary), §3.5 (degraded mode). Prototype + measured harness:
`spikes/e8-generation-loop/` (`FINDINGS.md`, `index.mjs`, `metrics.mjs`).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Provider abstraction + tenant-bounded governance | NFR-005 / ADP-025 | In Progress | #142 |
| 02 | Prompt assembly & context assembly | ADP-020 (context) | In Progress | #143 |
| 03 | Untrusted-data isolation boundary | ADP-024 | In Progress | #144 |
| 04 | Model tiering & prompt caching | ADP-011 (cost) | Not Started | #145 |
| 05 | Degraded-mode fallback (circuit breaker) | NFR-003 / ADP-042 | Not Started | #146 |
| 06 | Cost/latency spike (measured) | open Q3 / NFR-002 | In Progress | #147 |

## Dependencies
E1 exercise-context/query-scoping layer; persona dossiers (persona-management COR-020); the E2
publish pipeline (output path); the XC-004 telemetry emitter. Sibling E8 features `persona-voice-engine`,
`reaction-loop`, `storyline-model` build on this. The .NET backend is now bootstrapped (`src/Pulse.Core`,
this feature) — the provider interface is the contract seam. The frontend engine-review-cockpit
(#34–36) is storied but not yet built (it lands with the E7 controller console).

## Design notes
Staff/backend. **NFR-005 is a Phase-2 gate, not future:** every provider must satisfy the same
contract — tenant-bounded, contractual no-training, documented residency, ZDR as a config target.
The provider is a **swappable interface** (Azure OpenAI in-tenant is the v1 default; Claude via a
tenant-bounded endpoint — Foundry/Bedrock/Vertex — is the quality-preferred alternative), chosen by
the voice-fidelity eval (engine-eval-harness), never from preference. The injection boundary is
**defense in depth** — no single layer is trusted alone; red-team is acceptance testing
(engine-eval-harness story 02), not a backlog "harden later" item.
