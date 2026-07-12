# Story: Organic trending + controller boost-weight

**Feature:** Hashtags & trending  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-041 (CTL-021)  ·  **Design decisions:** D1-R5  ·  **Issue:** #107

## Context
The trending list derives **organically from actual activity** (velocity-weighted usage within the
exercise) — **never manually declared**. Controllers influence trends primarily by generating real
activity (E7/E8); additionally a **boost-weight lever** (E7 CTL-021) can bias a topic's trend weight
for conduct timing (#BoilWater trending at 14:00) — logged as a steering action, **never rendered as
anything but an organic trend** (SOC-041).

## Acceptance Criteria
- [ ] The trending list is computed from real activity (velocity-weighted usage), exercise-scoped
      (COR-001) — there is no way to directly "set" a trend.
- [ ] A controller **boost-weight** (E7 CTL-021) biases a topic's trend weight; the topic still renders
      as an ordinary organic trend — no "boosted/official" marker ever appears to participants.
- [ ] Boost-weight actions are logged as steering actions (XC-004) on the E7 side.
- [ ] Trend rows show **varied category labels** ("Trending", "Public safety · Trending", locale, "News
      · {outlet}") (D1-R5) — never an authority label.

## Out of Scope
The E7 boost-weight control UI (world-steering CTL-021); recompute cadence (story 03); search.

## Technical Notes
Participant world render + a trend-weight input the E7 lever biases. See implementation.md (story 02).

## Dependencies
story 01 (hashtags); posts activity; E7 CTL-021 (boost input); E8 ADP-004 (organic push).

## Tests
- Unit: trend ranking is activity-derived; a boost-weight biases ranking with no "boosted" marker in
  the output.
