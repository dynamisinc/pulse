# Story: Skin token file — The Scoop (tabloid, low credibility)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-001, NFR-001  ·  **Design decisions:** D3-P1, D3-P2, D3-P3  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** S

## Context
Fourth register (D3-P3) and the **one sanctioned busy design in the product**: busyness is the untrustworthiness signal. It is the only skin allowed `clutter` and `homeLead: 'clutter'`
(foundation 13 guard, server guard foundation 03). The clutter *components* are story 14; this file declares which modules are on.

## Acceptance Criteria
- [ ] **Token file validates.** `skinKey: 'the-scoop'` passes the schema; `clutter` and `layout.homeLead: 'clutter'` are accepted **only** because the key is the tabloid key (the same file under any other key is rejected, test).
- [ ] **D3-P3 values.** Type: Anton (ALL-CAPS `hedCase`, heavy) + Figtree body; palette yellow `#ffd400`, magenta `#e6007e`, black; `layout.rail: true`; `media.cropAggression` high (aggressive crops), `captionStyle` shouty; `breaking.vocabulary` "EXCLUSIVE!!" with banner style `rotated-flag`; `clutter: ['chip-row','rotated-flag','highlight-mark']`; `ext.news.masthead: 'tabloid-flag'`.
- [ ] **A11y floor survives the loud palette.** Every declared pair meets AA (black on yellow, white on magenta where used; magenta text on yellow is **not** used as text) via `contrast.ts`; the foundation clamp, not an exemption, enforces this; the file's test fails if a loud pair violates it.
- [ ] **Legibility under loudness.** Body copy stays ≥ 16px at mobile, regular-weight Figtree on a plain surface (the loudness lives in heds, chips and flags, not in the reading column); no moving/flashing decoration (no animation, nothing flashes > 3×/s, WCAG 2.3.1).
- [ ] **Fonts and zero layout code.** Anton/Figtree load only within the outlet scope with fallbacks (`registerSkinFonts`, F13); change set confined to `features/news/skins/the-scoop/**` plus its registration line.
- [ ] **Credibility signal reads.** A rendered comparison of the four skins' article head blocks (screenshot test in 20) shows The Scoop's clutter count and type loudness strictly higher than the other three (the training signal is preserved).

## Out of Scope
The clutter module components (14); the other skins; any real brand assets.

## Technical Notes
Participant world. Same ownership/registration approach as story 10 (`registerSkinTokens`, F13). The skin key `the-scoop` matches the foundation 03 default outlet seed and the foundation 13 tabloid-key guard (verify the exact key string there when building).

## Dependencies
Foundation 13 (clutter guard), 03 (server guard). Can run with every other E4-1 story; 14 consumes it.
