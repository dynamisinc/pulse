# Story: Preview as participant (staged, read-only, scenario-moment picker)

**Feature:** Staff shell frame  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-041  ·  **Design decisions:** D7-007  ·  **Issue:** #195

## Context
Controllers and planners need to see what participants see without leaving the console. **Preview as
participant** (COR-041) replaces the staff work area with the **participant shell** rendered in a
stage — **read-only** — with a **scenario-moment picker** (STARTEX / ADVISORY / BURST / NOW) that
drives the preview's alert state and content. It is the build/readiness check for the fiction, run
from inside the staff frame. The header button (story 01) toggles it on.

## Acceptance Criteria
- [ ] Given a staff surface, when the controller presses **Preview as participant**, then the work
      area is replaced by the participant shell (`participant-shell`, `variant: preview`) in a stage,
      **read-only**, and the header button shows its on-state.
- [ ] A **scenario-moment picker** offers mutually-exclusive chips **STARTEX / ADVISORY / BURST / NOW**;
      selecting one drives the preview's **alert state + content** to that moment.
- [ ] The preview is unmistakably a preview **within the staff frame** (it does not navigate away, does
      not open a participant session); exiting returns the prior work area.
- [ ] The preview is **read-only** — no affordance in it can post/act (it renders `participant-shell`'s
      read-only/preview variant, story 06); it is exercise-scoped (XC-001) and staff-only (XC-002).
- [ ] The control + picker are keyboard-operable and labelled; the moment chips announce selection
      state (NFR-001).

## Out of Scope
The participant shell **itself** (`participant-shell`; this story mounts it in a stage); real
participant sessions; the full readiness dashboard (exercise-build-golive `03-readiness-dashboard.md`,
COR-042 — preview is one input to readiness, not the dashboard).

## Technical Notes
Staff world frame hosting a participant-world render — the one place both worlds appear on one screen,
deliberately staged and labelled so the hard gate isn't violated (it reads as a preview, not a live
participant view). Drives `participant-shell` via `{variant: preview, scenarioNow: <moment>}` + a mock
alert state per moment. See implementation.md (story 04). D7-007 open item: portal-stub coverage only
in the mockup; real channels render in the implementation.

## Dependencies
`participant-shell` (the preview target, esp. variants story 06 + mount contract story 04); the staff
header button (story 01); exercise content for each moment (mockable). Ticks STORY-UPDATES.md §A.

## Tests
- Component (RTL): pressing Preview replaces the work area with the participant shell (read-only) and
  toggles the button on-state; exiting restores the work area.
- Component (RTL): moment chips are mutually exclusive and drive the preview alert state.
- Unit: the preview renders `variant: preview` (read-only) — no post affordance is present.
