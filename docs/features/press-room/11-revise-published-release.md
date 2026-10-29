# Story: Revise a published release (author side)

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-005 (+ foundation Q6)  ·  **Design decisions:** D4-009 (scenario-time markers, COR-053)  ·  **Issue:** #747
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 5  ·  **Effort:** S

## Context
Releases can be updated after publish with a visible "Updated 14:32" marker and prior versions preserved. Participants can **revise their own release** (visible `update` only); **retract is staff-only** (Q6 default).
This story is the author-side surface; the verb is story 05.

## Acceptance Criteria
- [ ] **Entry point.** Given an org member views their published release (wire row or permalink), then "Update this release" opens the sheet in revise mode; non-members and non-PIO see no affordance; there is **no** retract/withdraw control anywhere in the participant UI.
- [ ] **Revise = one confirm.** Given edits to headline/body/attachment/contact and an optional note ("Corrected the shelter address"), then one confirm states that a public "Updated {scenario time}" marker will appear; confirming calls `revise` and the sheet closes to the updated page.
- [ ] **Visible marker, preserved history.** Given a revision, then the release page shows "Updated {scenario time}" with the note (story 09) and the author/org members can open "Previous versions" listing each prior version with scenario time and who revised (display name); the public sees only the marker.
- [ ] **No silent levers.** Participants cannot choose `correction` or `silent_rewrite`; the UI offers only the labelled "update".
- [ ] **Conflicts.** Given a stale version (a colleague revised meanwhile), then a non-destructive reload prompt shows the diff; nothing is overwritten.
- [ ] **Accessibility and mobile.** Dialog focus-trapped, keyboard-operable, announcements polite, ≥ 44px targets, works at 360px; axe clean.
- [ ] **Two worlds.** wire-room skin; no COBRA/default MUI look.

## Out of Scope
Retract/restore (staff, F07/F17), staff correction and quiet-rewrite levers, approval of revisions, diff UI for the public.

## Technical Notes
Files: `features/press/composer/revise/**`; reuses story 07's `<ReleaseComposer>` in a `mode="revise"` prop and story 10's `DraftDiff` if merged (else a simple before/after list).

## Dependencies
Stories 05 (mock until live), 07. Can run with 08, 09, 10, 12, 13, 14.

## Tests
RTL for entry visibility by role, confirm, conflict, no-retract assertion; axe.
