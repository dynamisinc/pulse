# Story: Skin token file — The Courier-Ledger (city paper)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-001, NFR-001  ·  **Design decisions:** D3-P1, D3-P2, D3-P3  ·  **Issue:** #728
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** S

## Context
Second register file (D3-P3). Newspaper: serif, measured, text-forward, traditional grid. It must **not** read as the portal (D2-002 "print" risk; portal default stays broadcast), so the nameplate
treatment is deliberately specific to this outlet. Data only: no layout code.

## Acceptance Criteria
- [ ] **Token file validates.** `skinKey: 'courier-ledger'` passes the `OutletSkinTokens` schema (`schemaVersion: 1`), no unknown keys, no `clutter`.
- [ ] **D3-P3 values.** Type: `mastheadFamily`/`hedFamily`/`bodyFamily` Newsreader (serif), `kickerFamily`/meta Source Sans 3 with small-caps kicker; restrained gray palette (near-black text, warm off-white `bg`, hairline `rule`, muted accent); `layout.homeLead: 'text-lead'`, `layout.rail: true`; `media.cropAggression` low, `captionStyle` italic-serif; `byline.format` "By {name}, Staff Writer"; `breaking.vocabulary` "News Alert", banner style `rule` (understated); `ext.news.masthead: 'centered-nameplate'` with double rule.
- [ ] **A11y floor.** All declared pairs meet AA via `contrast.ts`; the unit test includes muted-gray meta text on the off-white background (the usual failure for "restrained" palettes).
- [ ] **Register legibility.** Snapshot tests of article, home and corrected states in this skin pass the four-skin slot-order test (04) and the text-lead home test (15).
- [ ] **Distinct from the portal and from Newsline 7.** A snapshot comparison shows this skin's masthead differs from the others in family and structure (nameplate vs bar), asserting credibility diversity (NWS-002) rather than only a palette swap.
- [ ] **Fonts and zero layout code.** Newsreader and Source Sans 3 load only within the outlet scope with serif/sans fallbacks (`registerSkinFonts`, F13); the change set is confined to `features/news/skins/courier-ledger/**` plus its registration line.

## Out of Scope
Layout and components; other skins; exercise-level overrides.

## Technical Notes
Participant world. Same ownership/registration approach as story 10 (`features/news/skins/<key>/tokens.ts`, `registerSkinTokens`, F13). The skin key is `courier-ledger` (matches the foundation 03 default outlet seed).

## Dependencies
Foundation 13. Can run with every other E4-1 story.
