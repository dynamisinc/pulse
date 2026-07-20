# Story: Match suggestion + trust curve

**Feature:** Response reaction  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** ADP-002a (open question 2)  ·  **Design decisions:** none  ·  **Issue:** #165

## Context
Resolves epic **open question 2** (how quickly can suggestion-with-confirmation earn trust to go
automatic). The engine **suggests** which storyline an official post addresses (similarity of the
post to the storyline `expectation` + hashtags) with a confidence, and the controller confirms Y/N.
The engine **logs its suggestions and the confirmations**, computes rolling precision, and once
precision holds over a sustained window the console **offers** a per-exercise opt-in
("auto-confirm matches above X% confidence") — which the controller flips. **The engine never raises
its own match-autonomy** (architecture §7.2).

## Acceptance Criteria
- [x] Given an official post, when it lands, then the engine computes a suggested storyline match with
      a confidence (similarity to expectation + hashtags) and surfaces it in the controller prompt
      ("does this address #X? Y/N").
- [x] Given controller confirmations over time, when suggestions are scored, then the engine tracks
      **rolling precision** of its suggestions within the exercise (telemetry-backed).
- [x] Given precision holds above a threshold over a sustained window, when the condition is met, then
      the console **offers** an opt-in to auto-confirm matches above a confidence cutoff — it is
      **never** auto-enabled by the engine.
- [x] Given auto-match is opted in, when the engine auto-confirms, then every auto-match is still
      logged and reversible, and the miss-safe default (story 02) still applies to anything below the
      cutoff.
- [ ] *(Deferred with #173 — blocked on the E1 XC-004 base; the trust curve holds precision/opt-in state ready to log, no cross-exercise learning.)* **Telemetry (XC-004):** suggestions, confirmations, precision, and any auto-match opt-in state
      are logged (staff-only, XC-002); no cross-exercise learning (epic §5 out of scope).

## Out of Scope
The reaction content (story 01); the slow-not-pause behavior (story 02 — this story feeds its
prompt); cross-exercise learning ("engine remembers previous exercises" is explicitly out, epic §5).

## Technical Notes
Staff/backend. Matching is embedding/keyword similarity of the official post to the storyline
`expectation` + hashtags. Precision = confirmed-correct / suggested, rolling within the exercise. The
opt-in is a per-exercise controller toggle — consistent with the autonomy-safety rule that automation
never self-escalates. See implementation.md (story 03) and architecture §7.2.

## Dependencies
Story 02 (the prompt this drives); storyline-model (expectation + hashtags); engine-telemetry-tuning
(precision tracking); console-shell / engine-review-cockpit (the prompt + opt-in UI).

## Tests
- Unit: a suggestion is produced with a confidence; confirmations update rolling precision.
- Unit: the auto-match opt-in is offered only after sustained precision and is never auto-enabled;
  auto-matches are logged and reversible.
