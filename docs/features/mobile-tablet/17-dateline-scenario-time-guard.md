# Story: Channel nav dateline never shows wall-clock time

**Feature:** Phones and tablets  ·  **Epic:** E1  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** COR-053, COR-061/062, NFR-001  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Audit gap G2: at 768 px and wider the `ChannelNav` dateline shows the **real wall-clock date** ("OCT 16, 2026") while posts show scenario time (Sep 4 2033).
Cause: no real `IExerciseClock` is installed on participant paths (exercise-clock story 01, #77, Not Started), so the default clock mirrors wall time. That
breaks COR-053 (scenario time only) and the fiction. Mitigation chosen: suppress the dateline while only the default wall-mirroring clock is installed.
Participant world. Also folds in the strip-link hit area (G4, "Social" link 43x28 at 768).

## Acceptance Criteria
- [ ] Given only the default wall-mirroring clock is installed (no real `IExerciseClock`), when the shell renders at 768 px and wider, then the dateline is not rendered and no wall-clock date or time appears anywhere in the channel nav (`expectNoWallClock`).
- [ ] Given a real `IExerciseClock` is installed (future #77), when the shell renders, then the dateline renders scenario time in the exercise time zone, with no code change beyond the clock install; a unit test covers both branches via an injected clock.
- [ ] Given the dateline is hidden, then the nav layout has no empty gap or shifted links at 768/1024/1280, and mobile (bottom tab bar) is unchanged.
- [ ] Given the channel nav strip links at 768 on a coarse pointer, then each link has a hit area of at least 44px tall and the current channel remains marked by text/underline, not color alone. *Amended at build (10/16):* an invisible hit-slop was intercepted by the fixed compliance band above and the social rail below, so on coarse pointers the strip itself grows from 38 to 44px (mouse layouts keep 38px; SHELL-CONTRACT §1 footnoted).
- [ ] *Added at Gate-1 (10/16):* the guard keys on `IExerciseClock.mirrorsWallClock` (an optional, additive field), not clock identity, so the controller's pausable clock (wall time minus frozen time) is also treated as wall-mirroring. Story 01's real provider omits the field and the dateline returns. Residual: content stamped by `scenarioNow()` under the mock (composed posts) is still wall-derived until #77, so COR-053 is not fully closed by this story.
- [ ] How the default clock is detected (flag or type on the clock seam in `core/clock`) is documented in the PR; if it needs a change to `core/clock`, keep it additive and flag it.
- [ ] User guide: no guide impact (the dateline is not documented), except removal of any mention in `docs/guide/participant-guide.md`.

## Out of Scope
Installing the real exercise clock (exercise-clock/01 #77), clock sync, any dateline redesign.

## Technical Notes
Files: `participant-shell/components/ChannelNav.tsx` (single owner; story 05 owns the rest of the shell). Uses `core/clock` and `core/time`. See `implementation.md` story 17.

## Dependencies
Story 01 (e2e kit). Superseded in effect when #77 lands.

## Tests
`ChannelNav.test.tsx` branches; `e2e/channel-nav.tablet.spec.ts` at 768 asserting no wall-clock date.
