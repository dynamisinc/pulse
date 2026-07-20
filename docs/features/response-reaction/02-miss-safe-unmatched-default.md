# Story: Miss-safe unmatched default (safety-critical)

**Feature:** Response reaction  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** ADP-002a  ·  **Design decisions:** none  ·  **Issue:** #164

## Context
**Safety-critical.** The failure mode that destroys evaluator trust is the world berating a PIO who
already answered (adversarial review D4/A6). The miss-safe default (ADP-002a): any **unmatched**
official content **immediately slows all active storyline escalation** (pressure stays honest — an
irrelevant post can't game the engine into calming down) but **never pauses** it, and prompts the
controller "does this address #WaterIssues? Y/N." Unmatched official content is **never treated as
silence.**

## Acceptance Criteria
- [x] Given **unmatched** official content, when it is posted, then all active storyline escalation
      **slows** (not pauses — escalation continues at a reduced rate) and the controller is prompted
      to confirm which storyline(s) it addresses.
- [x] Given unmatched official content, when it lands, then it is **never** counted as silence — the
      silence-escalation timer (silence-escalation story 01) is not satisfied by it, so the world
      never treats an answered concern as ignored.
- [x] Given the controller confirms a match (Y), when they do, then the storyline is treated as
      addressed (hands to story 01); given they decline (N), then escalation resumes its normal rate.
- [x] Given an irrelevant official post (spam/off-topic), when it lands, then it cannot pause or
      falsely satisfy any storyline — the slow-not-pause rule holds so the engine can't be gamed.
- [ ] *(Deferred with #173 — blocked on the E1 XC-004 base; the resolver produces the unmatched/slow/prompt signals ready to log.)* **Telemetry (XC-004):** the unmatched event + the slow + the controller prompt/decision are
      logged (feeds the trust curve, story 03, and E10 latency/coverage). Staff-only (XC-002).

## Out of Scope
The matched-response content (story 01); the suggestion/trust-curve mechanics (story 03); the silence
timer itself (silence-escalation story 01 — this story defines why unmatched ≠ silence).

## Technical Notes
Staff/backend. This is the load-bearing safety behavior of response-matching. "Slow, never pause,
never silence, prompt Y/N" — the prompt surfaces in the E7 cockpit (NEEDS YOU / match prompt). See
implementation.md (story 02), architecture §7.1, and adversarial-review D4.

## Dependencies
reaction-loop (slows the decide-stage escalation intent); silence-escalation (unmatched ≠ silence);
story 01 (a confirmed match hands here); story 03 (suggestion drives the prompt); console-shell
NEEDS-YOU + engine-review-cockpit (surfaces the prompt).

## Tests
- Unit: unmatched official content slows (not pauses) escalation and never satisfies the silence timer.
- Unit: Y → addressed; N → escalation resumes; an irrelevant post cannot pause/falsely-satisfy a
  storyline (the anti-gaming test).
