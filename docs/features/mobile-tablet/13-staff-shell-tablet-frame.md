# Story: Staff shell frame, toolstrip and flyouts at tablet sizes

**Feature:** Phones and tablets  ·  **Epic:** E1 (staff shell)  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** COR-018, NFR-001  ·  **Design decisions:** D7-011 (toolstrip dock)  ·  **Issue:** —

## Context
The shared staff shell (`StaffShellFrame`: header, work area `minmax(0,1fr) STAFF_TOOLSTRIP_WIDTH_PX`, right-edge toolstrip) hosts the console, planner
and evaluator. At 768-1180 px the header (exercise identity badge, clock, state pill, exercise switcher), toolstrip and flyouts (Personas dock, ENGINE, USAGE,
participant admin) must still fit and stay operable by touch. Staff world: COBRA.

## Acceptance Criteria
- [ ] Given each of 768, 820, 1024 and 1180 px wide, when the shell renders, then header items fit on one row or wrap/overflow deliberately into a "more" menu with no clipped text, and the exercise identity and state pill (never color-only) are always visible.
- [ ] Given the toolstrip, then every tool button has a hit area of at least 44x44 on touch (coarse pointer) with its label or accessible name; one flyout opens at a time (D7-011) and never extends past the viewport edge.
- [ ] Given a flyout (Personas dock, ENGINE, USAGE, participant admin) at 768 wide, then it is usable full-height with its own scroll, can be closed by a visible close button and Escape, and does not trap the user without a way back.
- [ ] Given the exercise-clock/state strip, then it renders in the same staff presentation as desktop and is never confusable with a participant view or its compliance chrome.
- [ ] Given a role other than controller, then the same guards apply and nothing new is exposed.
- [ ] Two-worlds and a11y: COBRA components only, FontAwesome icons, MUI 9 `sx`-only; focus order header -> work area -> toolstrip; tooltips have a touch equivalent (no hover-only information).
- [ ] User guide: staff header/toolstrip notes in `docs/guide/controller-guide.md` (tablet section shared with story 12).

## Out of Scope
Console pane layout (12), shortcuts (14), confirms (15), evaluator-specific layout (B4), a phone staff shell.

## Technical Notes
Files: `features/staffShell/{StaffShellFrame.tsx,staffShellTokens.ts}`, `components/{StaffHeader,Toolstrip}.tsx`. Tokens in
`staffShellTokens.ts` (`STAFF_HEADER_HEIGHT_PX`, `STAFF_TOOLSTRIP_WIDTH_PX`) gain tablet variants. `PreviewAsParticipant` (staff previewing the fiction) must still
read as a clearly framed preview at 768. See `implementation.md` story 13.

## Dependencies
Story 01.

## Tests
`StaffHeader*.test.tsx`/`Toolstrip.test.tsx` stay green; e2e in story 16.
