# Story: Approval gate participant UI

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-021  ·  **Design decisions:** D4-007, D4-002, C-1  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant ("participant paper", not staff chrome)  ·  **Wave:** 5  ·  **Effort:** M

## Context
The approval chain is itself evaluated, so the gate lives where the PIO and the JIC lead live: in the wire's letterhead world. A pending list, a draft-diff, an approve confirm chip, a return that
**requires a note**, and a "RETURNED FOR REVISION" banner back in the author's composer. A controller playing the approver uses this same participant view (C-1) — it is never staff console chrome.

## Acceptance Criteria
- [ ] **Inbox.** Given the signed-in human is a routed approver, then "Approvals (n)" appears in the Wire Room header (wire-internal badge, no platform push, D4-007 #3) and lists pending releases with org, headline, author display name, and "waiting 12m" in scenario time; non-approvers see no affordance.
- [ ] **Draft-diff review (D4-007).** Given a pending release, then the review shows the release on its letterhead with changes since the last version the approver saw: removed text struck through and added text shaded **with +/− markers and text labels** (not color-only), headline/contact changes called out, and the embedded PDF with a "document replaced" note when it changed.
- [ ] **Approve = one confirm.** Given the review, when "Approve & release" is chosen, then one confirm chip states org, headline and timing (now, or the author's embargo time); confirming releases it and the inbox updates live; Escape cancels with nothing sent.
- [ ] **Return requires a note (D4-007).** Given "Return for revision", then the note field is required (button disabled and reason announced until non-empty after trim), one confirm follows, and on confirm the release leaves the inbox.
- [ ] **Author sees the return.** Given a returned release, then the author's composer shows a "RETURNED FOR REVISION" banner (the `returnedBanner` slot of story 07) with the approver's name, scenario time and note; it stays until the author resubmits; the wire row for the author shows the same state.
- [ ] **Cancel-embargo trace (D4-002).** Given an embargo was cancelled, then approvers see an audit line in the review/inbox ("Embargo cancelled by J. Alvarez, 14:05"); the author's org sees the same trace.
- [ ] **Controller as approver (C-1).** Given a controller previewing as the participant role, then they get the identical view and their action is recorded as a controller approval; no COBRA control is rendered in this surface.
- [ ] **Accessibility (NFR-001, #680).** Inbox and diff are keyboard-operable; new-pending arrivals announced in a polite live region; diff semantics exposed via `<ins>`/`<del>` plus visible labels; dialogs focus-trapped; axe clean.
- [ ] **Mobile-first, two worlds.** Review fits 360px (diff stacks), wire-room skin only, no COBRA/default MUI look.
- [ ] **No leak (XC-002).** The UI renders only fields in the approval DTO; approver-only wall-clock data is never displayed.

## Out of Scope
Backend (06); staff settings UI (14); multi-stage chains; notifications beyond the wire; approving revisions to published releases.

## Technical Notes
Files: `features/press/approval/**` (`ApprovalInbox`, `ApprovalReview`, `DraftDiff`, `ReturnedBanner`, `useApprovals`). Mock-first against PC-3 approvals routes; polling plus `useChannelStream` hint if available.

## Dependencies
Story 06 (mock until live); 07 (banner slot); foundation F13, F14. Can run with 08, 09, 11, 12, 13, 14.

## Tests
RTL for inbox/diff/approve/return validation; banner round-trip with composer mock; axe; two-worlds import lint.
