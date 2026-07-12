# Story: Off-platform response marker

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-026 (ADP-002a)  ·  **Design decisions:** none  ·  **Issue:** #29

## Context
Not every official response happens inside Pulse — a press briefing, a phone call, a real alerting
system. One click records that an off-platform response occurred against a storyline/inject, with a
timestamp and a short note (CTL-026). This satisfies the engine's storyline expectations (stops
wrongful silence-escalation, ADP-002a) and annotates E10 latency/coverage so the AAR never reports a
false "unaddressed."

## Acceptance Criteria
- [ ] Given a storyline or inject, when the controller marks an off-platform response, then a record
      is created with the target storyline/inject, a scenario timestamp, and a short note — in one
      click plus the note.
- [ ] The marker **satisfies the storyline's expectation** the same way an on-platform official
      response would (ADP-002a): it stops silence-escalation for that storyline.
- [ ] The marker annotates E10 metrics so latency/coverage reflect the off-platform response (no false
      "unaddressed" in the AAR).
- [ ] The action is logged (XC-004), staff-only (XC-002), and exercise-scoped (COR-001).

## Out of Scope
The engine's silence-escalation logic (E8 ADP-001/002a); E10's metric rendering (E10) — this story
emits the signal both consume.

## Technical Notes
Staff world (COBRA). Writes an "off-platform response" event bound to a storyline/inject; the engine's
expectation-matching (ADP-002a) and E10 latency/coverage read it. See implementation.md (story 06).

## Dependencies
E8 storyline expectations (ADP-002a) consume it (Phase 2); E10 metrics annotate from it; console-shell.

## Tests
- Unit: the marker writes an event bound to the storyline/inject with scenario time + note.
- Unit: a marked storyline is treated as addressed (no silence-escalation) by the expectation check.
