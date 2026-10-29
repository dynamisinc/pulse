# Story: Section (category) pages

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-001 (category set), NWS-003, COR-053, NFR-001  ·  **Design decisions:** D3-P1, D3-P2  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-3  ·  **Effort:** S

## Context
"Category sections" from NWS-003: one page per outlet category (`/news/:outletSlug/section/:category`) listing that category's stories newest-first under the outlet's masthead. It reuses the
home's `StoryList`/`StoryRow` (15) so a section is the same rendering system with a filter, not a new layout.

## Acceptance Criteria
- [ ] **Listing.** Given `useContentList({ outlet, category })`, then the page lists published stories of that category newest-first with the shared `StoryRow`, a cursor-based "Load more", and a section `h1`; the category label is the outlet's own category name.
- [ ] **Unknown category.** Given a category not in `OutletDto.categories`, then the participant-world not-found renders (same as unknown outlet/article); a known category with no stories shows an in-fiction empty state.
- [ ] **Active nav.** The masthead nav (03) marks the section `aria-current="page"`; the section link set is the outlet's `categories`, order as configured.
- [ ] **Live + burst.** New/retracted stories in the section follow the same coalesced "N new stories" behavior and ≤ 1 announcement per 5 s as the home (15); the list does not shift under the reader's scroll.
- [ ] **Skin, time, isolation, a11y.** Skin tokens only (no `clutter` outside the Scoop), times via `ScenarioDateline`, exercise-scoped data and 404 parity (XC-001/002), mobile-first single column, 44px targets, axe clean in all four skins.

## Out of Scope
Cross-outlet categories; tag/topic pages; search; section-specific skins; editing categories (outlet admin, foundation 03/17).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/section/{SectionPage}.tsx` + tests. Imports `StoryList`/`StoryRow` from `features/news/home`. Container wiring in 02.

## Dependencies
E4 15 (StoryList/StoryRow), 03; foundation 15 (hooks), 02. Can run with 17.
