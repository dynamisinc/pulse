# Story: Latency/cost SLO measurement

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** NFR-002, NFR-003  ·  **Design decisions:** none  ·  **Issue:** #177

## Context
Automated measurement of p50/p95 generation latency and per-burst cost per provider/model, checked
against the §4 envelope and the degraded-mode trip threshold. Seeded by the one-time cost/latency
spike (engine-generation-infra story 06); this story is the *ongoing* SLO monitor that replaces
modeled numbers with measured ones and catches regressions (a model/provider/prompt change that blows
latency or cost).

## Acceptance Criteria
- [ ] Given the generation path per provider/model, when the SLO suite runs, then it records p50/p95
      latency and per-burst cost at representative burst sizes.
- [ ] Given measured latency, when compared to the envelope (architecture §4.1), then a breach of the
      cost or latency budget is surfaced as a failure.
- [ ] Given the degraded-mode trip threshold (engine-generation-infra story 05), when p95 is measured,
      then the threshold is validated/updated from data (not the placeholder ~10s).
- [ ] Given a provider/model/prompt change, when the SLO suite runs, then a latency or cost regression
      is caught before it ships.
- [ ] Reports are **staff/tuning-facing** (XC-002); the live run uses only tenant-bounded providers
      (NFR-005).

## Out of Scope
The one-time spike (engine-generation-infra story 06 — this is the ongoing monitor it seeds); the
degraded-mode fallback behavior (engine-generation-infra story 05 — this validates its threshold);
cost *optimization* (engine-generation-infra story 04 tiering/caching).

## Technical Notes
Staff/backend. Reuses the spike's cost calculator (`metrics.mjs` `costUSD`/`PRICING`) and latency
capture (streamed TTFT + total). Runs per provider/model. See implementation.md (story 03) and
architecture §4/§12.3.

## Dependencies
engine-generation-infra stories 01/04/05/06 (provider, tiering, breaker threshold, the seeding spike);
tenant-bounded provider credentials.

## Tests
- The suite itself: produces p50/p95 latency + per-burst cost tables per provider/model; a simulated
  budget breach fails the check.
