# Story: Trainee monitor flyout (adaptive-loop signal)

**Feature:** Console shell  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** console UI architecture (D5)  ·  **Design decisions:** D5-016, D5-014/3.1  ·  **Issue:** #13

## Context
A controller steering the world needs a quick read on the humans in it. A consult-on-demand
**Trainee monitor** flyout shows a card per trainee — role, live status, last action, and how they're
tracking against expectations — so the controller knows when to escalate or ease off. This is the
**partial** slice: full PIO monitoring is its own future surface; storyline cards keep only a one-line
trainee signal.

## Acceptance Criteria
- [ ] Given the Trainee monitor flyout, when it opens, then it shows a card per trainee with role,
      **live status** (ACTIVE / IDLE / DRAFTING), last action, response-time-vs-target, and
      expected-action progress.
- [ ] The status and progress are conveyed by text/label/icon, **not color alone** (NFR-001), and
      update in near-real-time as trainees act.
- [ ] Storyline cards elsewhere in the console carry a one-line trainee signal (e.g. "PIO drafting")
      consistent with this flyout.
- [ ] Data is scoped to the **active exercise** (COR-001) and is staff-only (XC-002); trainees never
      see it.
- [ ] The flyout is a consult-on-demand toolstrip tool (story 01) with an escalation status badge.

## Out of Scope
Full PIO/participant monitoring analytics and scoring (E10 evaluation; a future surface); editing or
messaging trainees from the card.

## Technical Notes
Staff world (COBRA). Reads live participant activity (the same XC-004 telemetry stream feeding
live-monitoring CTL-030) plus expected-action state (CTL-032). Registers as a consult-on-demand tool.
See implementation.md (story 05).

## Dependencies
Story 01 (shell/flyout host); the participant-activity telemetry stream (XC-004); expected-action
tracking (live-monitoring CTL-032). Full analytics defer to E10/D6.

## Tests
- Component (RTL): a trainee card shows status/last-action/progress with non-color-only status.
- Unit: the trainee list is scoped to the active exercise.
