# Story: Cross-persona diversity — burst generation + thresholds

**Feature:** Persona voice engine  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** ADP-021  ·  **Design decisions:** none  ·  **Issue:** #149

> **Delivered:** `PersonaVoice/Services/BurstAcceptancePolicy` — scores a burst with the merged
> `VoiceMetrics` thresholds and re-rolls a failing burst up to a bound (`Decide` → accept / re-roll / drop);
> relies on the assembler's burst-in-one-call (`PostCount = personas.Count`). Tests:
> `BurstAcceptancePolicyTests` (clean passes, blended fails, bound → drop).

## Context
Output across personas must be **diverse** — tone, literacy, emoji habits, perspective — and must not
converge on one authorial voice (ADP-021). The engine generates a **burst in one call** (multiple
personas together) so the model differentiates them, which produces far more divergence than N
independent single-persona calls (which regress to a house style — the spike demonstrates this). A
burst that fails the diversity thresholds is **re-rolled or its outliers resampled** before any human
sees it.

## Acceptance Criteria
- [x] Given a burst request for N personas, when the engine generates, then it produces all N in a
      single call so the model sees the personas together and differentiates them.
- [x] Given a generated burst, when it is scored, then it must pass the diversity thresholds (max
      pairwise trigram overlap < 0.2, distinct-2 > 0.7, per-persona distinctiveness > 0.4) before it
      is eligible to reach the review queue.
- [x] Given a burst that fails a diversity threshold, when it is detected, then the engine re-rolls
      the burst (or resamples the offending persona) up to a bounded number of attempts, and never
      surfaces a converged burst.
- [x] Given repeated re-roll failures, when the bound is hit, then the burst is dropped and the event
      is logged (telemetry XC-004) rather than surfacing low-quality content.
- [x] **LLM governance (NFR-005):** diversity is enforced by the acceptance gate, not assumed from
      the model.

## Out of Scope
Voice consistency (story 01); persona-type behavior (story 03); the metric functions themselves
(story 04 defines them; this story *applies* them as a pre-review gate); the human review UI
(engine-review-cockpit).

## Technical Notes
Staff/backend. Burst = one `emit_posts` call for N personas (engine-generation-infra story 02).
Thresholds + functions are `spikes/e8-generation-loop/metrics.mjs` (`maxPairwiseOverlap`, `distinct2`,
`personaDistinctiveness`), shared with story 04 / engine-eval-harness. See implementation.md (story 02)
and architecture §5.2/§5.3.

## Dependencies
engine-generation-infra stories 02+03 (burst generation + pre-review guard); story 04 (metric
functions); reaction-loop (requests the burst).

## Tests
- Unit: a burst is generated in one call for N personas.
- Unit: a deliberately-blended burst fails the thresholds and triggers a re-roll; a clean burst passes
  (mirrors the spike's harness self-check).
