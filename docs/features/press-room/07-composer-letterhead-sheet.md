# Story: Composer — the letterhead sheet

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-002 (rich-text-first; PDF as attachment), PRS-004, PRS-001  ·  **Design decisions:** D4-001, D4-005, D4-006, Q-03 (Tom, 10/29)  ·  **Issue:** #743
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 4  ·  **Effort:** L

## Context
"The critical screen" — designed for a stressed PIO. The composer **is** the release artifact: letterhead and contact block prefilled, a **rich-text body** (Tom, 10/29, Q-03: rich text first) and the headline as the only
required input. A finished PDF is an optional **download-only attachment**, not the body; inline PDF rendering and headline-from-PDF suggestion are post-December (story 03). It is **not** a form, and it is **not** the staff console. This story builds the sheet and its inputs; timing/cross-post/confirm (08) and revise (11) and the
returned banner (10) plug into declared slots.

## Acceptance Criteria
- [ ] **The sheet, not a form (D4-001).** Given a PIO opens "New release", then the screen renders as the letterhead sheet in the `wire-room` skin: org letterhead + contact block prefilled from `ReleaseOrgDto`, a "FOR IMMEDIATE RELEASE" line, dateline, a large headline field, and the body area; there are no form labels/admin chrome around it, and the only inputs are on the sheet.
- [ ] **Rich-text body is the primary input (PRS-002, Q-03).** Given the body area, then it is a rich-text editor that emits only the `rich-tables` allowlist (headings, lists, tables, bold/italic, safe links), and **pasting from Word is first-class, not a fallback**: Word formatting that is in the allowlist survives, everything else is stripped (the server sanitizer is authoritative; the client shows the cleaned result); a pasted script, handler or `javascript:` link is inert. The editor library is the one chosen for Q-13 (shared with news 17; this story's PR proposes it if Q-13 is still open, so Q-13 is now needed by CW4, not CW5).
- [ ] **PDF is an optional download-only attachment (PRS-002).** Given a quiet "Attach a PDF" affordance under the body (keyboard-operable "Choose a PDF" button, drag-and-drop on desktop), when a PDF is picked, then it uploads through `POST /api/press/documents` and shows as an **attachment chip** (file name, size, `Replace`, `Remove`) — no page rendering, no headline suggestion — and **nothing publishes** as a result of the attach; a rejected PDF (cap, deny-list scan) shows a readable reason from story 02, never a raw error. The attach control is simply not rendered if the document kind is unavailable (story 02 cut).
- [ ] **Headline is the only required input.** Given a headline and nothing else, then the sheet is publishable (a non-blocking note says the release has no body or attachment); with no headline, publish is disabled with a reason announced to assistive tech.
- [ ] **Image attachment.** Given an image dropped or picked, then it uploads through the existing media path, needs alt text (prompted, not blocking), and renders on the sheet with `ExerciseBands` when required.
- [ ] **Releasing as (D4-005, PRS-001).** Given the human may release as more than one org, then a "Releasing as {org} ▾" chip (reusing the existing "Posting as" UI in the social `Composer.tsx` where it fits; `posts/06` is not a December dependency) swaps letterhead, contacts and paired handle live, one identity at a time, granted orgs only; with one org the chip is read-only text.
- [ ] **Ambient autosave (D4-006, PRS-004).** Given edits, then a passive header status shows "Saving…" → "Saved at {scenario time}" (scenario time, COR-053); there is **no Save button**; a failed save shows a persistent "Not saved — retry" status and keeps the local text; a 409 prompts a non-destructive reload showing what changed.
- [ ] **Capture disclosure (NFR-007).** Given the edit timeline is retained for evaluation, then the sheet shows the standing disclosure string from story 12 in the header's help text (not a modal).
- [ ] **Accessibility (NFR-001, #680).** The rich-text editor is keyboard-operable with labelled toolbar controls, the attachment control has a keyboard-operable "Choose a PDF" button and a live-region announcement for upload/saved/error states; the Releasing-as chip is keyboard-reachable; autosave status is text, not color-only; axe clean; targets ≥ 44px on coarse pointers.
- [ ] **Mobile-first (D0 §4.6).** At 360px the sheet is single-column, letterhead collapses to a compact header, the toolbar collapses to a compact bar, the attachment control is "Attach a PDF", and the publish panel slot sits in a sticky bottom bar; no horizontal scroll.
- [ ] **No-enterprise-look and two worlds.** Sheet uses wire-room skin tokens; no COBRA, no default MUI look, FontAwesome only; no `Date.now()`/`toLocale*`.

## Out of Scope
Inline PDF rendering and headline-from-PDF suggestion (story 03 and the old D4-001 sign-off #11, post-December), release timing, cross-post, the confirmation sheet (08); revise-after-publish (11); approval banner content (10, slot only); wire/permalink (09); staff composer (13); a separate "save draft" affordance (D4-006).

## Technical Notes
Files: `features/press/composer/sheet/**`; exposes `<ReleaseComposer>` with slots `publishPanel`, `returnedBanner`, and **owns the shared `ScheduledChip`** (`composer/sheet/ScheduledChip.tsx`: amber, ⏱ icon + text, scenario-clock countdown; imported by 08 and 09 so neither depends on the other). Runs on `features/press/mocks/` until 04 lands (PC-2 is the seam). Reuse `core/media` upload, `ExerciseBands`, `useScenarioTime`.

## Dependencies
Stories 01; 04 (mock until live); foundation F13, F14 (**no longer depends on story 03**). Needs the approved rich-text library (Q-13) before it starts. Can run with 05, 06, F15, F16, F17, F18, F19.

## Tests
RTL for rich-text paste sanitization display, attach (no publish), autosave states, chip; axe; a mobile-width snapshot check; manual stress-path walk (type or paste → headline → publish).
