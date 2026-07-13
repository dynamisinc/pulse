# Story: Voice-diversity & fidelity checks

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-021  ·  **Design decisions:** none  ·  **Issue:** #175

## Context
ADP-021 requires diversity checks in acceptance criteria. This story runs the §5.3 believable+diverse
metric (shared with persona-voice-engine story 04) as **automated regression** over generated bursts —
max pairwise trigram overlap, distinct-2, per-persona distinctiveness, style-param conformance — plus
periodic **human spot-check** panels during tuning to keep the automated proxies honest. It runs in
CI-style regression as prompts/models change.

## Acceptance Criteria
- [ ] Given a corpus of generated bursts, when the check runs, then it scores each against the §5.3
      metric and reports pass/fail per burst with the failing check(s) named.
- [ ] Given a prompt or model change, when the regression runs, then any drop below the diversity/
      fidelity thresholds is surfaced as a failure (guards against a change that quietly flattens the
      crowd voice).
- [ ] Given tuning, when a human spot-check panel reviews a sample, then the panel's believability
      pass rate is recorded and compared to the automated proxies (the proxies must track the humans).
- [ ] Given the metric functions, when used here, then they are the **same pure functions** as the
      pre-review gate (persona-voice-engine story 04) — one implementation, two call sites.
- [ ] Reports are **staff/tuning-facing** (XC-002); no participant exposure.

## Out of Scope
The pre-review re-roll gate (persona-voice-engine story 02 — same metric, different call site); the
injection suite (story 02); SLOs (story 03); scenario tests (story 04); tuning the thresholds
(engine-generation-infra story 06 spike).

## Technical Notes
Staff/backend. Graduate `spikes/e8-generation-loop/metrics.mjs`; run as Vitest regression over a burst
corpus (frontend harness per CLAUDE.md; backend equivalent when it lands). See implementation.md
(story 01) and architecture §12.1.

## Dependencies
persona-voice-engine story 04 (the shared metric); a burst corpus (from the spike / live runs); the
Vitest harness.

## Tests
- The suite itself: runs the metric over a corpus, fails on threshold drops (self-checking, as the
  spike's harness self-check demonstrates — clean burst passes, blended burst fails).
