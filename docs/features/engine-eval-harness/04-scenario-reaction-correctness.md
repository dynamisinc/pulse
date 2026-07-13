# Story: Scenario reaction-correctness tests

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** §12.4, ADP-001, ADP-002a, ADP-042, CTL-034  ·  **Design decisions:** none  ·  **Issue:** #178

## Context
The hardest and most important suite: **did the world react correctly to action *and inaction*?**
End-to-end scenario tests assert the reaction loop's behavior, including the safety-critical
miss-safe default (anti-berate-the-PIO) and the CTL-034 workload budget. A regression in the
miss-safe or kill-switch scenarios **blocks release**.

## Acceptance Criteria
- [ ] Given a storyline whose window blows with no official response, when the scenario runs, then
      intensity rises per the curve and anxiety/speculation content appears (**inaction → escalation**,
      ADP-001).
- [ ] Given a *matched* official response, when it lands, then intensity/sentiment bend down and a
      response-reaction burst appears (**action → calming**, ADP-002).
- [ ] Given an *unmatched* official post, when it lands, then escalation **slows but does not pause**,
      the controller is prompted, and the storyline is **not** marked addressed — the
      **anti-berate-the-PIO** test (ADP-002a, adversarial review D4); a regression here blocks release.
- [ ] Given an off-platform marker (CTL-026), when set, then the storyline is treated as addressed
      identically to an on-platform match.
- [ ] Given the kill switch or degraded-mode trip, when fired, then autonomy drops to Suggest and
      nothing auto-publishes (ADP-042); given rate caps / quiet floors, then no firehose and no
      flatline (ADP-011).
- [ ] Given NFR-002 burst load at Delayed-auto, when measured, then sustained controller **demand
      ≤6/min** (CTL-034); a design that breaches it fails the suite.

## Out of Scope
The behaviors themselves (silence-escalation / response-reaction / autonomy-safety / storyline-model
implement them — this *verifies* them end to end); voice metrics (story 01); injection (story 02);
raw SLOs (story 03).

## Technical Notes
Staff/backend. Scripted scenarios driving the reaction loop against a fixture exercise, asserting
storyline state transitions + generated-content properties + demand counts. The miss-safe and
kill-switch scenarios are release-gating. See implementation.md (story 04) and architecture §12.4.

## Dependencies
reaction-loop, storyline-model, silence-escalation, response-reaction, autonomy-safety,
amplification-engine (the behaviors under test); off-platform marker (#29); the Vitest harness /
future backend test suite.

## Tests
- The suite itself: each scenario (inaction→escalation, action→calming, miss-safe slow-not-pause,
  off-platform parity, kill-switch/degraded→Suggest, cap/floor honored, demand ≤6/min) asserts the
  correct end-to-end behavior; miss-safe + kill-switch regressions block release.
