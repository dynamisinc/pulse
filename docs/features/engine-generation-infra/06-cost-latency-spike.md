# Story: Cost/latency spike (measured)

**Feature:** Engine generation infrastructure  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** epic open question 3, NFR-002  ·  **Design decisions:** none  ·  **Issue:** #147

## Context
A first-class story (the epic flags the cost/latency envelope as needing a spike before story-level
commitment). A throwaway prototype + analytic cost model **already exists** at
`spikes/e8-generation-loop/` (see `FINDINGS.md`): the generate→review loop, the injection-isolation
prompt structure, and the eval-metric harness are built and self-validated, and the cost envelope is
answered analytically (~$1.50–3.60 per exercise-hour tiered; cost is not a blocker). **This story is
the live-key measurement pass** that replaces the *modeled* latency and voice-quality numbers with
*measured* ones before story estimates and SLOs lock.

## Acceptance Criteria
- [ ] Given a tenant-bounded provider with credentials, when the spike harness runs live, then it
      records **measured** p50/p95 generation latency and per-burst cost for the Sonnet-tier and
      Haiku-tier at representative burst sizes.
- [ ] Given the measured numbers, when they are compared to the analytic model in `FINDINGS.md`, then
      any material divergence is documented and the exercise-hour envelope (architecture §4.1) is
      updated.
- [ ] Given measured latency, when p95 is known, then the **degraded-mode trip threshold** (story 05)
      is set from data rather than the placeholder ~10s.
- [ ] Given the live output, when voice bursts are scored by the metric harness (`metrics.mjs`), then
      the believable+diverse gates are checked against real (not fixture) generations and the
      thresholds are confirmed or tuned.
- [ ] **LLM governance (NFR-005):** the live run uses only a tenant-bounded, no-training endpoint —
      the spike does not send exercise-adjacent content to an ungoverned provider.

## Out of Scope
Productionising the harness (its checks graduate into engine-eval-harness); provider *selection*
(story 01); ongoing SLO monitoring (engine-eval-harness story 03 — this is the one-time
measurement pass that seeds it).

## Technical Notes
Staff/backend. Re-run `spikes/e8-generation-loop/index.mjs` with `ANTHROPIC_API_KEY` (or the
Azure/tenant-bounded equivalent) set; capture the streamed TTFT + total latency + `usage`. The
harness is throwaway; its *metrics* and *prompt structure* are the reusable artifacts. See
implementation.md (story 06) and architecture §4.

## Dependencies
Stories 01–04 (a real provider + prompt + tiering to measure); a tenant-bounded endpoint with
credentials. Feeds engine-eval-harness (SLO story) and every E8 estimate.

## Tests
- Manual/measured: the harness produces p50/p95 latency + per-burst cost tables per tier; results
  recorded alongside `FINDINGS.md`.
