# Story: Composer — timing, cross-post and the single confirm gate

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-003, PRS-013, PRS-020 (gate wording)  ·  **Design decisions:** D4-002, D4-003, D4-004  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 5  ·  **Effort:** M

## Context
The decision half of the composer: release now or embargo, whether and how to socialize, and the one confirmation. Deciding *whether and how* to socialize is the evaluated PIO craft (PRS-013),
and the embargo state must be unmistakable by redundancy (D4-003). Fills the `publishPanel` slot of story 07.

## Acceptance Criteria
- [ ] **Now or schedule.** Given a valid sheet, then the panel offers "Release now" and "Embargo until…" (a scenario-time picker, default = current scenario time + 15 min, ≥ now); times are shown and entered in scenario time and the exercise time zone (COR-053); never wall clock.
- [ ] **Sheet line flips (D4-003).** Given an embargo time is set, then the sheet's "FOR IMMEDIATE RELEASE" line becomes "EMBARGOED — HOLD UNTIL {scenario time}"; clearing the time flips it back.
- [ ] **Redundant scheduled state (D4-003).** Given a scheduled release, then an amber "SCHEDULED — releases in 19m" chip (⏱ icon + text + color, never color-only, countdown from the server scenario clock) shows on the composer, and the same story-07 chip is what story 09 uses on the author's wire row and permalink; the countdown stops when the clock is frozen and jumps correctly with COR-051.
- [ ] **Cross-post is explicit (D4-004).** Given the panel, then a checkbox "Also post from @{org handle}" is **unchecked by default**, names the org handle, and when checked renders a live link-card preview (from `crosspost-preview`) with editable post text (≤ 280 code points, headline by default); changing the org (Releasing as) swaps the handle and card.
- [ ] **Exactly one confirmation gate (D4-002).** Given publish or embargo, then **one** confirm sheet restates org, headline, timing ("now" or the embargo time) and cross-post (handle + text or "No social post"); confirming sends `confirmed: true`; there is no second dialog; Escape/cancel returns to the sheet with nothing sent.
- [ ] **Cancel embargo confirms (D4-002).** Given a scheduled release, when "Cancel embargo" is used, then one confirm names that approvers will be notified (when the gate is on) and that a wire audit trace is left; on confirm it returns to draft.
- [ ] **Approval-aware.** Given the org requires approval, then the primary action reads "Submit for approval", the confirm sheet says it is not yet public, and after confirm the composer shows "Pending approval" (state from the author API).
- [ ] **Result and errors.** Given a publish, then the result shows the permalink and, if cross-post was requested, its outcome (posted/skipped/failed) without blocking; 409/validation errors keep the sheet intact with a readable message.
- [ ] **Accessibility (NFR-001, #680).** Confirm sheet is a focus-trapped, labelled dialog returning focus; chip and states announced via `LiveRegionAnnouncer` (polite); keyboard-operable picker; severity-style states carry icon + text.
- [ ] **Mobile-first, two worlds.** Panel works in the sticky bottom bar at 360px (confirm as a bottom sheet); wire-room skin only; no COBRA/default MUI look.

## Out of Scope
The approval review UI (10); revise after publish (11); retract; media-persona embargo behavior; scheduling UI for staff (F17); notification of approvers beyond the wire.

## Technical Notes
Files: `features/press/composer/publish/**`; exports `PublishPanel`; imports `ScheduledChip` from story 07. Uses `useScenarioTime`/`formatScenarioTime`, `LiveRegionAnnouncer`, the scenario clock hook for the countdown. Mock-first against PC-3.

## Dependencies
Story 07 (slot); 05 (mock until live); foundation F05 semantics. Can run with 09, 10, 11, 12, 13, 14.

## Tests
RTL for each state; countdown with a faked scenario clock (frozen, jump); confirm-sheet content test; cross-post default-off test; axe.
