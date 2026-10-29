# Story: The Scoop clutter-module set (Scoop-only)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-003, NFR-001  ·  **Design decisions:** D3-P2, D3-P3  ·  **Issue:** #731
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
D3-P2 "clutter modules (sanctioned set, The Scoop only)". The set is chip rows (TRENDING / SHOCKING / MUST SEE), rotated flags ("EXCLUSIVE!!"), and yellow highlight marks. These are the only
decorative-noise components in Pulse, and they exist to signal low credibility. They render **only when the active skin's token file lists them in `clutter` and the key is the tabloid key**.

## Acceptance Criteria
- [ ] **Sanctioned set only.** Given the module registry, then it contains exactly `chip-row`, `rotated-flag`, `highlight-mark` (`features/news/clutter/`); an unknown module name in a token file is ignored and logged once; adding a module is a code change, not a token edit.
- [ ] **Scoop-only enforcement.** Given any skin other than the tabloid key (including one that lists `clutter` in overrides), then `<ClutterSlot>` renders **nothing** (test per skin, hostile overrides included); the server rejects `clutter` for other skins (foundation 03), and this is the defense-in-depth render guard.
- [ ] **Chip row.** Given `chip-row`, then it renders labelled chips (TRENDING, SHOCKING, MUST SEE) from a fixed vocabulary in the outlet voice; chips are **decorative and non-functional**: not links, not buttons, `aria-hidden`, never driven by real trending/telemetry data (NWS-030 invisibility; no reader-visible metric), and never shown as a view or popularity count.
- [ ] **Rotated flag and highlight.** Rotated flags are a static CSS tilt (≤ 6°) with real text content (reads in DOM order, not an image); highlight marks wrap authored hed words via a skin utility without altering the hed text for assistive tech; neither animates.
- [ ] **Placement in the invariant anatomy.** Clutter appears only in sanctioned positions (above the head block as chip row; inside the hed; beside list items on the home, 15); it never reorders or occludes a fixed slot, the watermark chip, the share control or the discussion footer (D3-P2 CANNOT list); a layout test asserts the nine-slot order and watermark visibility are unchanged with clutter on.
- [ ] **A11y and mobile.** Clutter never causes horizontal scroll at 320px, never covers text, contrast of chip text meets AA (not color-only: chips have text), and `prefers-reduced-motion` has nothing to reduce; axe clean.

## Out of Scope
Ads, popups, interstitials or any interactive clutter; clutter for other outlets; real "trending" data; the Scoop's token values (13).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/clutter/{ClutterSlot,ChipRow,RotatedFlag,HighlightMark}.tsx` + tests. Reads `useOutletSkin().clutter` and the skin key through the foundation scope; never reads outlet overrides directly.

## Dependencies
Foundation 13 (clutter guard and skin hook). Can run with 03, 05–13.
