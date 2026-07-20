# Feature: Response reaction

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.1
**World:** staff / backend  ·  **Issue:** #132

## Summary
How the world reacts when officials *do* respond — and, safety-critically, how it behaves when an
official post doesn't clearly address anything. A matched response calms the crowd (gratitude,
follow-up questions, one skeptic) and bends intensity/sentiment down. An **unmatched** official post
**slows but never pauses** escalation and prompts the controller — it is never treated as silence, so
the world never berates a PIO who already answered.

## Requirements covered
ADP-002 (response reaction), ADP-002a (miss-safe matching default). Resolves epic open question 2
(the response-matching trust curve). Consumes off-platform markers (CTL-026 / #29) as identical
satisfiers.

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §7 (response-matching, miss-safe default, trust curve).
Adversarial review D4/A6 (the anti-berate-the-PIO requirement). `docs/features/world-steering/06-off-platform-response-marker.md` (#29).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Matched-response reaction | ADP-002 | Done (decide policy + bend; generate blocked) | #163 |
| 02 | Miss-safe unmatched default (safety-critical) | ADP-002a | Complete | #164 |
| 03 | Match suggestion + trust curve | ADP-002a (open Q2) | Complete | #165 |

**Delivered** as the pure-backend `Pulse.Core/Features/ResponseReaction/*` slice (see its `README.md`):
`ResponseMatcher` + `ResponseMatchTrustCurve` (suggestion + rolling precision + offer-only opt-in, engine
never self-escalates match-autonomy), `MissSafeResolver` (the safety-critical slow-not-pause / never-silence
/ anti-gaming logic + the off-platform-marker identical satisfier + the storyline bend via
`RecordMatchedResponse`), and `ResponseReactionBehavior` (the tunable gratitude/follow-up/skeptic reaction
intent). The generate→publish of the reaction, the controller-prompt/opt-in UI (E7 cockpit), and the XC-004
logging (#173) are the remaining blocked/deferred pieces.

## Dependencies
`reaction-loop` (decide/generate), `storyline-model` (intensity/sentiment bend, expectation),
`persona-voice-engine` (voiced reactions), off-platform marker (#29, identical satisfier),
silence-escalation (a match stops escalation), engine-telemetry-tuning (match events feed the trust
curve + E10).

## Design notes
Staff/backend. The **miss-safe default (ADP-002a)** is the safety heart: unmatched official content
**slows** all active escalation (pressure stays honest; irrelevant posts can't game the engine) but
**never pauses** it, prompts the controller "does this address #X? Y/N", and is **never** silence.
Off-platform responses (CTL-026) satisfy expectations identically. The **trust curve** (open Q2):
suggestion-with-confirmation at launch; earn auto-match by measured precision, per-exercise
controller opt-in, **never self-escalated**.
