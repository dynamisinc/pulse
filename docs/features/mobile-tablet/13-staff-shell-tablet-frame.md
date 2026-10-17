# Story: Staff shell frame, toolstrip and flyouts at tablet sizes

**Feature:** Phones and tablets  ·  **Epic:** E1 (staff shell)  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** COR-018, NFR-001  ·  **Design decisions:** D5-021 (tablet bands by width; touch sizing gated separately by `(pointer: coarse)`), D5-024 (touch parity: every keyboard-only action has a visible 44px control; Esc has a visible close), D7-011 (toolstrip dock, one flyout at a time); [`D5-controller-console/TABLET-AMENDMENT.md`](../../design/D5-controller-console/TABLET-AMENDMENT.md), signed by Tom 10/17  ·  **Issue:** —

## Context
The shared staff shell (`StaffShellFrame`: header, work area `minmax(0,1fr) STAFF_TOOLSTRIP_WIDTH_PX`, right-edge toolstrip) hosts the console, planner
and evaluator. At 768-1180 px the header (exercise identity badge, clock, state pill, exercise switcher), toolstrip and flyouts (Personas dock, ENGINE, USAGE,
participant admin) must still fit and stay operable by touch. Staff world: COBRA.

## Acceptance Criteria
- [x] (Verified manually in Playwright; formal e2e in story 16.) Given each of 768, 820, 1024 and 1180 px wide, when the shell renders, then header items fit on one row or wrap/overflow deliberately into a "more" menu with no clipped text, and the exercise identity and state pill (never color-only) are always visible.
- [x] Given the toolstrip, then every tool button has a hit area of at least 44x44 on touch (coarse pointer) with its label or accessible name; one flyout opens at a time (D7-011) and never extends past the viewport edge.
- [x] Given a flyout (Personas dock, ENGINE, USAGE, participant admin) at 768 wide, then it is usable full-height with its own scroll, can be closed by a visible close button and Escape, and does not trap the user without a way back.
- [x] Given the exercise-clock/state strip, then it renders in the same staff presentation as desktop and is never confusable with a participant view or its compliance chrome.
- [x] Given a role other than controller, then the same guards apply and nothing new is exposed.
- [x] Two-worlds and a11y: COBRA components only, FontAwesome icons, MUI 9 `sx`-only; focus order header -> work area -> toolstrip; tooltips have a touch equivalent (no hover-only information).
- [x] User guide: staff header/toolstrip notes in `docs/guide/controller-guide.md` (tablet section shared with story 12).

## Implementation notes (story 13)
- Bands by width only (`STAFF_TABLET_QUERY` < 1280, `STAFF_TABLET_PORTRAIT_QUERY` < 1024 in `staffShellTokens.ts`); the 44px
  sizing is `@media (pointer: coarse)` real layout space (no `::before`/`::after` slop).
- Header: at < 1280 the wall clock, presence and Preview-as-participant move into a "more" popover; identity, scenario clock, state
  pill and the FOUO tag never move (portrait stacks pill + tag). Sign-out is icon-only in portrait (name kept).
- Flyouts: one `staffFlyoutPanelSx` (`staffShell/staffFlyout.ts`) for the participant-admin, ENGINE and USAGE panels. **z-order:**
  header (own grid row) and toolstrip (own column) are structurally uncoverable; flyouts sit at `staffShellTokens.flyout.zIndex` (30)
  inside the work-area row, above work-area content; MUI popovers/dialogs (1300+) sit above flyouts. `--staff-flyout-top` is an
  opt-in seam only for surfaces whose band sits inside the flyouts' containing block; unset (the default), flyouts are full
  work-area height.
- Open items: story 12 does NOT use `--staff-flyout-top` (its flyouts stay in its pane area below the band), so it stays unset
  there; the persona dock (`controller/console/personaDockHost.tsx`, story 12's file)
  gets the clamp/top/44px-close contract from the frame via a selector until it adopts `staffFlyout.ts`. Browser e2e is story 16.
- Deferred: before Complete, check the four widths with a long exercise name, plus desktop at exactly 1280 with a long name
  (the frame grid change affects overflow there).

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
