# Story: Corrections (two renderings), "Updated" stamp and retraction tombstone

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-013, NWS-010, COR-053, XC-010, NFR-001  ·  **Design decisions:** D3-P4, D3-P1 (slot 8), D3-P2  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
NWS-013 had an internal conflict (always append an editor's note vs. the lever "quietly rewrite"). D3-P4 settles it: exactly **two renderings**, controller-selectable per revision. They map to
foundation `RevisionKind` (FC-1): **`correction`** = visible editor's-note append in the correction slot (slot 8; skin-styled, position/semantics/a11y fixed); **`silent_rewrite`** = body text
changes, only the "Updated" scenario-time stamp moves, **no** note. `update` (a plain "Updated 14:32", PRS-005's kind) renders as the stamp. Retraction is the foundation's soft delete: an in-fiction
**tombstone** at the permalink (foundation default Q1). The conflict resolution is flagged in the epic sync (see `feature.md` open question 1) — the epic text is not silently rewritten.

## Acceptance Criteria
- [ ] **Visible correction.** Given `revisions[]` containing `kind: correction` entries, then the correction slot renders each as a skin-styled editor's note with the label from the skin ("Correction" / "Editor's note" / "CLARIFICATION"), the note text, and its **scenario** time (`ScenarioDateline`); newest-first or chronological per `skin` token is not configurable (chronological, fixed); the slot sits between body and discussion footer (D3-P1) and is a `section` with an accessible name and `role="note"` semantics identical in all skins.
- [ ] **Silent rewrite.** Given an item revised with `silent_rewrite` (the participant DTO carries a new `bodyHtml` and a later `updatedScenarioTime` but **no** revisions entry for it), then the page shows the new body and the "Updated {scenario time}" stamp only; no note, no diff, no marker anywhere in any skin. A test asserts the DOM has no element referencing the rewrite besides the stamp (FC-1: a silent rewrite moves `updatedScenarioTime`, adds no `revisions[]` entry).
- [ ] **Updated stamp.** Given `updatedScenarioTime`, then the head block's dateline appends "Updated {time}" per `skin.dateline.format`, in scenario time only (COR-053); absent when never revised; a correction also moves the stamp.
- [ ] **Live revise.** Given `ContentRevised` arrives while the page is open (foundation 09/15 `useChannelStream`), then the page refetches the item and updates without losing scroll position; a new correction note is announced once via the polite `LiveRegionAnnouncer` ("Correction added to this story"); a silent rewrite announces nothing (it is silent by design).
- [ ] **Retraction tombstone (XC-010, foundation Q1 default).** Given `state: retracted` (DTO has only id/outlet/slug/permalink/`retractedScenarioTime`), then the permalink renders in the outlet's skin: masthead + a skin-voiced notice ("This story is no longer available" / outlet-specific token string) with the retraction scenario time; the **headline and body are not shown**; the discussion footer is hidden; cached copies of the body are discarded client-side on `ContentRetracted`. List/home entries disappear on the same event (15).
- [ ] **Not color-only + AA.** The correction note and tombstone carry a text label and an icon/border cue, ≥ 4.5:1 contrast, and are reachable by keyboard; link/share affordances are removed from the tombstone.
- [ ] **No reader-visible telemetry.** Nothing on corrections or tombstones indicates who has seen them (NWS-030 invisibility).

## Out of Scope
The controller UI to pick a rendering (17 passes `correction` vs `silent_rewrite` through foundation 17's Revise dialog); revision-history page for readers (not in the epic); a staff revision diff viewer; restore (a restore simply re-publishes; the page renders normally).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/revisions/{CorrectionSlot,CorrectionNote,UpdatedStamp,RetractedTombstone}.tsx` + tests. Props `{ item, skin }`. Skin string tokens for labels are under `ext.news` (`registerSkinExtension`, F13) with neutral defaults.

## Dependencies
Foundation 14, 13, 02 (fixtures incl. a `correction` and a `retracted` item), 09/15 (live merge, mock until live). Can run with 03, 05–07, 09–14.
