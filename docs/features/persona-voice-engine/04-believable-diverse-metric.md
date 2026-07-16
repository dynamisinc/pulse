# Story: The believable + diverse acceptance metric

**Feature:** Persona voice engine  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-021  ·  **Design decisions:** none  ·  **Issue:** #151

## Context
ADP-021 requires diversity checks **in acceptance criteria** (e.g. n-gram overlap thresholds across a
burst). This story defines the reusable **acceptance metric** for "believable + diverse" as pure
functions, used both as the pre-review re-roll gate (story 02) and as a maintained regression gate
(engine-eval-harness story 01). The functions are prototyped and self-validated in the spike.

## Acceptance Criteria
- [ ] Given a burst, when it is scored, then the metric computes: max pairwise **trigram overlap**,
      **distinct-2** (unique bigrams / total), and per-persona **lexical distinctiveness** (own
      content words vs the rest of the burst).
- [ ] Given a persona post, when it is scored against its dossier, then **style-param conformance**
      (emoji/length/caps/hashtag within tolerance) is computed (the consistency half, from story 01).
- [ ] Given the v1 thresholds (overlap < 0.2, distinct-2 > 0.7, per-persona distinctiveness > 0.4,
      style conformance pass), when a burst is evaluated, then a single pass/fail is produced with the
      failing check(s) named.
- [ ] Given a deliberately-blended burst, when scored, then it **fails** the diversity checks; given a
      clean burst, it **passes** — i.e. the metric catches real failures (the spike's harness
      self-check).
- [ ] The metric is exposed as **pure functions** (no I/O) so it runs identically in the pre-review
      gate and in CI-style regression as prompts/models change.

## Out of Scope
The human spot-check panel process (engine-eval-harness); applying the gate to re-roll (story 02);
tuning thresholds against live data (engine-generation-infra story 06 spike / engine-eval-harness).

## Technical Notes
Staff/backend. Graduate `spikes/e8-generation-loop/metrics.mjs` (`maxPairwiseOverlap`, `distinct2`,
`personaDistinctiveness`) into a shared library, adding style-param conformance. Thresholds are v1
proposals to be tuned against real bursts. Shared with engine-eval-harness story 01. See
implementation.md (story 04) and architecture §5.3.

## Dependencies
story 01 (style params); story 02 (consumes the metric as a gate); engine-eval-harness story 01
(consumes it as regression); the spike prototype.

## Tests
- Unit: each metric function returns expected values on hand-built bursts.
- Unit: the combined pass/fail fails a blended burst and passes a clean one (harness self-check
  parity with the spike).
