# Story: Escalating anxiety/speculation content

**Feature:** Silence escalation  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-001, ADP-010  ·  **Design decisions:** none  ·  **Issue:** #162

## Context
The content half: when an escalation trigger fires (story 01), generate escalating public anxiety and
speculation, following the storyline's escalation curve (ADP-010). As the window stays blown,
intensity climbs and the content shifts — worried questions → "why is X silent?" → speculation — the
"vacuum fills" arc from the epic UX (§4). This is the reactive behavior that makes a missed decision
have visible public consequences.

## Acceptance Criteria
- [ ] Given an escalation trigger, when the engine generates, then it produces a persona-voiced burst
      of anxiety/speculation appropriate to the storyline and its current intensity (via
      reaction-loop decide→generate).
- [ ] Given rising intensity as the window stays unaddressed, when successive bursts generate, then
      the tone escalates per the curve (Slow burn gradual, Flash panic steep) — later bursts are
      visibly more anxious/speculative than earlier ones.
- [ ] Given the escalation, when it raises intensity, then storyline intensity increases per the curve
      (storyline-model story 02) and the change is measured (reaction-loop story 04).
- [ ] Given a matched official response arriving mid-escalation, when it lands, then escalation stops
      and hands off to response-reaction (the storyline transitions toward ADDRESSED).
- [ ] **LLM governance (NFR-005 / ADP-024):** generation is via the tenant-bounded provider with the
      isolation boundary; **content guard (ADP-023):** escalation never breaks fiction; **Telemetry
      (XC-004):** bursts emit `engine.generated`/`engine.published`. Staff-only origin (SOC-003).

## Out of Scope
The trigger timing (story 01); response reaction (response-reaction); rumor activation on the
escalation (rumor-model, v1.1); the review/publish plumbing (reaction-loop story 03).

## Technical Notes
Staff/backend. Registers a decide-stage policy (reaction-loop story 02) mapping an inaction trigger +
current intensity → a generation intent (personas, anxious/speculative tone mix, count). Content is
generated + guard-filtered + reviewed via the reaction loop. See implementation.md (story 02) and
architecture §1.2/§6.

## Dependencies
Story 01 (trigger); reaction-loop (decide/generate/publish/measure); storyline-model (curve/intensity);
persona-voice-engine (voiced bursts); response-reaction (takes over on a match).

## Tests
- Unit: an inaction trigger produces an anxiety/speculation intent; successive unaddressed bursts
  escalate per the curve.
- Unit: a matched response mid-escalation stops it and transitions the storyline toward ADDRESSED.
