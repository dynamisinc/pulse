# Story: News channel mount and routes

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-011, NWS-015, NWS-003 (route shell), COR-053  ·  **Design decisions:** D3-P1, D7-001  ·  **Issue:** #719
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-4  ·  **Effort:** M

## Context
The foundation channel router (foundation 12) mounts a channel by path prefix through `registerChannel()` (FC-8) and hides it when the exercise has not enabled it (foundation 08). This story is
E4's single registration: the route table under `/news`, the per-outlet skin scope per route subtree, and the thin data containers that feed the presentational pages (04, 15, 16) from the foundation
hooks. It is last in E4 order because it only assembles. Social keeps `/` unchanged; `/news` is a new participant route group (FC-4).

## Acceptance Criteria
- [ ] **Registration.** Given the channel registry, then `features/news/index.ts` calls `registerChannel` once for `news` with `/news` (outlet index), `/news/:outletSlug` (home, 15), `/news/:outletSlug/section/:category` (section, 16) and `/news/:outletSlug/:contentSlug` (article, 04). Matching is by segment count, so no slug is reserved (test: an article slugged `section` still resolves).
- [ ] **Skin scope per subtree (D3-P1).** Given `/news/newsline-7/…`, then `OutletSkinScope` for that outlet wraps only that subtree; navigating to `/news/the-scoop/…` swaps skins with no token bleed, and the shell chrome and alert bar (outside the scope) keep the exercise brand. No `@/theme/*` (COBRA) import anywhere in `features/news/**` (static test).
- [ ] **Permalinks (NWS-011).** Given an article permalink opened cold (a shared link on a phone), then after login return-to (foundation 12) it renders under the outlet's brand; the permalink is built only through `contentPermalink()` and is host-relative (FC-9.3).
- [ ] **Unknown / disabled / cross-exercise.** Given an unknown outlet or article, a draft or scheduled item, an item from another exercise, or `news` disabled for the exercise, then the participant-world not-found view renders (`ChannelNotFound`), indistinguishable between cases (XC-001/002); never the COBRA 404, never the default MUI look.
- [ ] **Outlet index.** Given `/news`, then it lists the exercise's enabled news outlets (`useOutlets('news')`), each with its own skin accent and logo; with exactly one outlet it redirects to that home; with none it shows an in-fiction empty state.
- [ ] **Focus, time, a11y.** Route changes move focus to the page `h1` and announce the page title politely; any time shown comes from the shared formatter (COR-053); the route table is in the conformance axe sweep (story 20).

## Out of Scope
The pages (04, 15, 16); channel nav chrome (shell, D7); outlet admin; a cross-outlet "all news" aggregate (portal, E3, owns cross-channel top stories).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/index.ts`, `routes.tsx`, `NewsChannel.tsx`, `containers/*`. The `registerChannel()` import is wired by the orchestrator-owned composition seam, not by editing `features/channels/routing/registry.ts`. React Router 7.

## Dependencies
E4 04, 15, 16; foundation 12 (router), 15 (hooks), 13 (skin scope), 08 (enablement). Can run with: nothing (assembly).
