# Story: Article page grid, head block and assembly

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-010, NWS-011, NWS-002, NWS-030 (invisibility), COR-053, NFR-001  ·  **Design decisions:** D3-P1, D3-P2  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-2  ·  **Effort:** L

## Context
The article page is the core unit. This story owns the **grid** (12-col well, max 1140px, 680px body column ≈ 66ch, optional 340px rail as a skin token, rail folds below body on mobile), the
**head block** (kicker → headline → dek, byline · scenario dateline · share slot), the page states, and the **assembly order** of slots owned by other stories (03 masthead, 07 breaking, 05 hero,
06 body, 08 correction, 09 footer). The nine-slot order is invariant across skins (D3-P1). Each slot component takes `{ item: ChannelContentDto, skin: OutletSkin }` (contract in `implementation.md`).

## Acceptance Criteria
- [ ] **Slot order is fixed.** Given any skin, then DOM order is masthead (03) → breaking (07) → kicker/hed/dek → byline·dateline·share → hero (05) → body (06) → correction (08) → discussion footer (09); a test renders all four skins and a fifth fake token file and asserts the identical landmark sequence (a skin cannot reorder; no token key addresses order).
- [ ] **Grid.** Given ≥ 1024px, then content sits in a 12-col well ≤ 1140px with a 680px body column; given `layout.rail: true` the 340px rail renders beside the body, given `false` the body centers; given < 768px it is one column, the rail folds **below** the body, and body text is ≥ 16px (D3-P1, NFR-001). No horizontal scroll at 320px.
- [ ] **Head block.** Kicker (optional, skin case/family), headline as the single `h1`, dek, byline from `byline.name` formatted by `skin.byline.format` (org/staff bylines legal: "BY THE NATIONAL WIRE", "By Scoop Staff"; absent byline renders nothing, no placeholder), and dateline `ScenarioDateline` (foundation 14) using `skin.dateline.format`; the wire dateline place comes from `payload.dateline` (National Wire style "FAIRHAVEN, Fulton County (NW) —").
- [ ] **Scenario time only (COR-053).** Given `publishedScenarioTime` / `updatedScenarioTime`, then the page shows them only via `ScenarioDateline` in the exercise time zone; no wall-clock value, `Date.now()` or `toLocale*` exists in `features/news/**` (lint/test); "Updated" appears only when `updatedScenarioTime` is present (08 owns its wording).
- [ ] **States.** Loading shows a skin-styled skeleton with the head-block height reserved (no layout shift); error shows a retry in the outlet's voice; a `retracted` item renders the 08 tombstone; unknown item is the foundation not-found (02). Nothing shows draft/scheduled state.
- [ ] **Invisible telemetry (NWS-030).** The page mounts `useContentViewTelemetry` (foundation 15) and renders **no** view count, dwell, "trending" or reader indicator in any skin (test across skins; the Scoop's clutter chips are static authorial decor, not data).
- [ ] **No enterprise look + accessibility.** Only `OutletSkinScope` tokens style the page; no COBRA/default-MUI visual; landmarks (`header`, `nav`, `main`, `article`, `footer`) are correct, skip-to-content reaches `main`, focus order follows DOM order, axe has no serious/critical findings per skin at 360px and 1280px (NFR-001, #680).

## Out of Scope
The slot internals (03, 05–09); the home and section pages (15, 16); route wiring (02); print stylesheet; related-articles module (not in the epic).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/article/{ArticlePage,HeadBlock,ArticleGrid}.tsx`, `article/states/*`, CSS modules + tests. Presentational: takes a `ChannelContentDto`; the container in 02 supplies it. Runs on foundation 02 fixtures until 06/15 land. Grid values are CSS custom properties (`--news-well: 1140px; --news-body: 680px; --news-rail: 340px`).

## Dependencies
E4 03, 05, 06, 07, 08, 09; foundation 13, 14, 02 (fixtures). Can run with 15, 19.
