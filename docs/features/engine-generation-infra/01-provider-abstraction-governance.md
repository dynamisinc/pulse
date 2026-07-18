# Story: Provider abstraction + tenant-bounded governance

**Feature:** Engine generation infrastructure  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress
**Requirements:** NFR-005, ADP-025  ·  **Design decisions:** none  ·  **Issue:** #142

## Context
All E8 generation runs against **tenant-bounded endpoints under contractual no-training terms with
documented residency** (NFR-005/ADP-025) — a Phase-2 gate, not a future concern. Because the
government-adjacent customer base has varying approved-provider lists, the generation service sits
behind a **swappable provider interface** (the same pattern as the COR-050 clock provider): the
reaction loop never imports a vendor SDK directly. v1 default is Azure OpenAI in the customer/Dynamis
Azure tenant (NFR-006 alignment); Claude via a tenant-bounded endpoint (Foundry/Bedrock/Vertex) is
the quality-preferred alternative. See architecture §3.1.

## Acceptance Criteria
- [ ] Given the engine, when it generates content, then it calls a **provider interface** (not a
      vendor SDK directly), so the concrete provider is swappable per deployment without touching the
      reaction loop.
- [ ] Given any configured provider, when the deployment is validated, then it is confirmed
      **tenant-bounded, under contractual no-training terms, with documented residency**, and its
      config records the residency/retention posture (NFR-005/ADP-025) — a deployment gate.
- [ ] Given a zero-data-retention deployment target, when a provider/model is selected, then a
      provider that cannot honor ZDR (or a model unavailable under ZDR) is rejected with a clear
      configuration error rather than silently used.
- [ ] Given generation input that includes named-government-employee content, when it is processed,
      then it is handled as records per the retention posture (NFR-007) and never sent to a
      non-tenant-bounded endpoint.
- [ ] **LLM governance (NFR-005):** the endpoint is tenant-bounded/no-training; participant/world
      content entering generation is untrusted data (isolation handled in story 03).
- [ ] The provider config and every provider selection is **staff-only** (XC-002) and
      exercise-scoped where per-exercise (COR-001).

## Out of Scope
The prompt content/assembly (story 02); the isolation boundary internals (story 03); model choice +
caching (story 04); the fallback behavior (story 05). The eval that *ranks* providers by voice
fidelity (engine-eval-harness).

## Technical Notes
Staff/backend. Define `IGenerationProvider` (assemble request → return structured posts + usage +
latency). Concrete adapters: Azure OpenAI in-tenant (default), Claude-via-Foundry/Bedrock/Vertex.
Governance metadata (tenant, no-training attestation, residency, retention) is config, surfaced for
the security questionnaire (NFR-006). Backend .NET absent — this interface is the contract seam.
See implementation.md (story 01) and architecture §3.1.

## Dependencies
E1 exercise-context layer; deployment/config. Consumed by stories 02–06 and every generation-driven
E8 feature.

## Tests
- Unit: the reaction loop resolves generation through the interface; swapping the concrete provider
  changes nothing upstream.
- Unit: a provider failing the tenant-bounded/no-training/ZDR gate is rejected at config validation.
