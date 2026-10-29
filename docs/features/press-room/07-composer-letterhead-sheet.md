# Story: Composer — the letterhead sheet

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-002, PRS-004, PRS-001  ·  **Design decisions:** D4-001, D4-005, D4-006  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 4  ·  **Effort:** L

## Context
"The critical screen" — designed for a stressed PIO. The composer **is** the release artifact: letterhead and contact block prefilled, the PDF drop zone is the body, the headline is the only
required input and is suggested from the PDF. It is **not** a form, and it is **not** the staff console. This story builds the sheet and its inputs; timing/cross-post/confirm (08) and revise (11) and the
returned banner (10) plug into declared slots.

## Acceptance Criteria
- [ ] **The sheet, not a form (D4-001).** Given a PIO opens "New release", then the screen renders as the letterhead sheet in the `wire-room` skin: org letterhead + contact block prefilled from `ReleaseOrgDto`, a "FOR IMMEDIATE RELEASE" line, dateline, a large headline field, and the body area; there are no form labels/admin chrome around it, and the only inputs are on the sheet.
- [ ] **PDF drop zone is the body (PRS-002).** Given the body area, when a PDF is dropped, picked, or pasted from the file picker on mobile, then it uploads through `POST /api/press/documents`, renders inline via `PdfPages` (story 03) with `Replace`, and **nothing publishes** as a result of the drop.
- [ ] **Headline auto-suggest (D4-001, sign-off #11).** Given an accepted PDF with a `suggestedHeadline` and an empty headline, then a one-click "Use as headline" appears; accepting fills the field, ignoring leaves it untouched, and the suggestion never overwrites text the PIO typed.
- [ ] **Headline is the only required input.** Given a headline and nothing else, then the sheet is publishable (a non-blocking note says the release has no body/PDF); with no headline, publish is disabled with a reason announced to assistive tech.
- [ ] **Paste-from-Word is quiet and secondary (PRS-002).** Given a "Type or paste instead" affordance below the drop zone, when used, then a rich-text area keeps headings/lists/tables/bold/italic from Word and strips everything else (server sanitizer is authoritative; client shows the cleaned result); a pasted script or `javascript:` link is inert; this path is never more prominent than the drop zone.
- [ ] **Image attachment.** Given an image dropped or picked, then it uploads through the existing media path, needs alt text (prompted, not blocking), and renders on the sheet with `ExerciseBands` when required.
- [ ] **Releasing as (D4-005, PRS-001).** Given the human may release as more than one org, then a "Releasing as {org} ▾" chip (reusing the D1 "Posting as" chip component) swaps letterhead, contacts and paired handle live, one identity at a time, granted orgs only; with one org the chip is read-only text.
- [ ] **Ambient autosave (D4-006, PRS-004).** Given edits, then a passive header status shows "Saving…" → "Saved at {scenario time}" (scenario time, COR-053); there is **no Save button**; a failed save shows a persistent "Not saved — retry" status and keeps the local text; a 409 prompts a non-destructive reload showing what changed.
- [ ] **Capture disclosure (NFR-007).** Given the edit timeline is retained for evaluation, then the sheet shows the standing disclosure string from story 12 in the header's help text (not a modal).
- [ ] **Accessibility (NFR-001, #680).** Drop zone has a keyboard-operable "Choose a PDF" button and a live-region announcement for upload/saved/error states; headline suggest and chip are keyboard-reachable; autosave status is text, not color-only; axe clean; targets ≥ 44px on coarse pointers.
- [ ] **Mobile-first (D0 §4.6).** At 360px the sheet is single-column, letterhead collapses to a compact header, the drop zone becomes "Choose a PDF", and the publish panel slot sits in a sticky bottom bar; no horizontal scroll.
- [ ] **No-enterprise-look and two worlds.** Sheet uses wire-room skin tokens; no COBRA, no default MUI look, FontAwesome only; no `Date.now()`/`toLocale*`.

## Out of Scope
Release timing, cross-post, the confirmation sheet (08); revise-after-publish (11); approval banner content (10, slot only); wire/permalink (09); staff composer (13); a separate "save draft" affordance (D4-006).

## Technical Notes
Files: `features/press/composer/sheet/**`; exposes `<ReleaseComposer>` with slots `publishPanel`, `returnedBanner`, and **owns the shared `ScheduledChip`** (`composer/sheet/ScheduledChip.tsx`: amber, ⏱ icon + text, scenario-clock countdown; imported by 08 and 09 so neither depends on the other). Runs on `features/press/mocks/` until 04 lands (PC-2 is the seam). Reuse `core/media` upload, `ExerciseBands`, `useScenarioTime`.

## Dependencies
Stories 01, 03; 04 (mock until live); foundation F13, F14. Can run with 05, 06, F15, F16, F17, F18, F19.

## Tests
RTL for drop (no publish), suggest, paste sanitization display, autosave states, chip; axe; a mobile-width snapshot check; manual stress-path walk (drop → headline → publish).
