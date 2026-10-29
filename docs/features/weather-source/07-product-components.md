# Story: Product components — severity chip, IBW grid, NWS product text

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-010, WX-011, NFR-001, NFR-008, COR-053  ·  **Design decisions:** D4-009, D4-010, D4-012  ·  **Issue:** #758
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** M

## Context
The reusable pieces that make a Weather Desk product read like NWS: the severity chip, the IBW What/Where/When/Impacts grid, the monospace product text with its furniture, the Issued/Effective/Expires
block and the state banner. Presentational, data-in, no fetching; used by the site (08), permalink (09), widget (10) and the staff preview (via the participant subtree). They style from the Weather Desk
tokens through CSS variables so they work before the channel mount (06) exists.

## Acceptance Criteria
- [ ] **`SeverityChip`.** Given `productType` (watch|warning|advisory), then it renders **icon + text (WATCH / WARNING / ADVISORY) + colour**, white text on `#2e6b4f` / `#8b0000` / the advisory hue at >= 4.5:1; the text is always present (never color-only, NFR-001) and a test renders it under forced-colors/greyscale checks and asserts the text node.
- [ ] **`IbwGrid`.** Given `ibw`, then it renders **What / Where / When / Impacts** as a semantic definition list (`<dl>`), in that order, with the labels as authored by NWS convention; on narrow viewports it stacks label-over-value without horizontal scroll; an absent `ibw` (watch/advisory) renders nothing rather than empty rows.
- [ ] **`ProductText`.** Given a product, then it renders monospace product text with the NWS furniture assembled from structured data: `...{headline}...` line, narrative, `PRECAUTIONARY/PREPAREDNESS ACTIONS...` section from `actions`, `&&` after the body and `$$` at the end; the headline string is rendered **exactly as stored** (no CSS `text-transform`, no truncation) so copy/paste equals the alert and post text (D4-010); wraps with `white-space: pre-wrap` and preserves authored line breaks.
- [ ] **`ProductTimes`.** Given effective/expires/issued, then **Issued / Effective / Expires** render through `ScenarioDateline` in scenario time in the exercise time zone, never "scenario time" wording and never wall clock (COR-053); a lint rule forbids `Date.now`/`toLocale*` in the module.
- [ ] **`ProductStateBanner`.** Given `productState` pending / expired / cancelled, then a banner with icon + text ("IN EFFECT UNTIL …" is the active default and shows no banner; "EXPIRED", "CANCELLED", "EFFECTIVE IN …") appears, recomputed from `scenarioNow` so it flips without a refetch.
- [ ] **Imagery.** Given product/forecast media, then `ProductImagery` wraps `ContentMedia` + `WatermarkSlot` so the bottom-right EXERCISE chip is reserved and visible when required, with `ExerciseBands` on the media and required alt text (NFR-008, D4-012).
- [ ] **Accessibility and look.** The components pass `axe` (no serious/critical) in Vitest, have no COBRA import and no default MUI look (token/CSS-variable styling only), respect reduced motion, and keep >= 44 px targets on coarse pointers.

## Out of Scope
Fetching, routing, page layout (06, 08, 09); the alert bar; staff-side editors; the forecast period list (08).

## Technical Notes
Files: `src/frontend/src/features/weather/components/product/**` (+ tests). Reuse `features/channels/primitives` (`ScenarioDateline`, `WatermarkSlot`, `ContentMedia`), `features/weather/contract` types and `productState`. MUI 9 `sx`-only. Icons: `faTriangleExclamation` (warning), `faEye` (watch), `faCircleInfo` (advisory) via FontAwesome registration.

## Dependencies
01 (types, `productState`), F14 (primitives). Can run with 02, F05, F06, F07, F11, F12.
