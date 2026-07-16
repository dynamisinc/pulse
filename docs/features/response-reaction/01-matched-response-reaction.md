# Story: Matched-response reaction

**Feature:** Response reaction  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-002  ·  **Design decisions:** none  ·  **Issue:** #163

## Context
When an official post/release is matched to a storyline (controller-confirmed, or engine-suggested
then confirmed — story 03), the engine generates a **mixed but tunable** public reaction — gratitude,
follow-up questions, one skeptic — and bends the storyline's intensity/sentiment down per the curve.
This is the "timely, accurate release calms the crowd" half of the differentiator, and it sets up the
v1.1 rumor crowd-correction mechanic.

## Acceptance Criteria
- [ ] Given an official post matched to a storyline, when the engine reacts, then it generates a
      persona-voiced burst with a **tunable mix** (default: mostly gratitude + follow-up questions +
      one skeptic), appropriate to the storyline's cast.
- [ ] Given a matched response, when it lands, then the storyline transitions toward **ADDRESSED** and
      intensity/sentiment bend **down** per the escalation curve's `decayRateAddressed`
      (storyline-model).
- [ ] Given an off-platform marker (CTL-026 / #29), when it addresses the storyline, then it triggers
      the same matched-response behavior as an on-platform match (identical satisfier).
- [ ] Given active silence-escalation on the storyline, when a match lands, then escalation stops and
      hands off to this reaction.
- [ ] **LLM governance (NFR-005/ADP-024) + content guard (ADP-023):** generation via the tenant-bounded
      provider with isolation; never breaks fiction. **Telemetry (XC-004):** the reaction emits
      `engine.generated`/`engine.published` and a `storyline.state_changed` (→ADDRESSED). Staff-only
      origin (SOC-003).

## Out of Scope
The miss-safe unmatched path (story 02); match suggestion/trust curve (story 03); the decay math
(storyline-model story 02); the off-platform marker UI (#29 owns it — this consumes its event).

## Technical Notes
Staff/backend. Registers a decide-stage policy (reaction-loop story 02): matched-response event +
storyline → a gratitude/follow-up/skeptic intent with a tunable mix. Decay is storyline-model's. See
implementation.md (story 01) and architecture §7.

## Dependencies
Story 03 (produces confirmed matches); reaction-loop (decide/generate); storyline-model (decay,
ADDRESSED transition); persona-voice-engine; off-platform marker (#29); silence-escalation (hands off).

## Tests
- Unit: a matched response yields a mixed-tone reaction and bends intensity/sentiment down toward
  ADDRESSED.
- Unit: an off-platform marker triggers the identical reaction; a match stops active escalation.
