# Story: Outlet masthead and section nav

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-001, NWS-002, NWS-003, NFR-001  ·  **Design decisions:** D3-P1 (slot 2), D3-P2  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
Slot 2 of the D3-P1 anatomy: the outlet masthead and category nav, shared by the article page (04), the home (15) and the section pages (16). The masthead is the first credibility signal, and it is
a **skin-driven rendering of one component** (Newsline 7 bar + LIVE chip, Courier-Ledger centered nameplate with double rule, National Wire mono timestamp strip, The Scoop loud flag). A fifth outlet adds
no code here. It lives **inside the shell content region**; the shell owns chrome, alert bar and channel strip (SHELL-CONTRACT §1).

## Acceptance Criteria
- [ ] **One component, skin-selected variants.** Given `<OutletMasthead outlet skin />`, then name, tagline and logo come from `OutletDto`, and layout/typography/rule weights come only from skin tokens plus `ext.news.masthead` (registered through F13's `registerSkinExtension`, F03 allowlists the namespace); a test mounts a fake fifth outlet token file and asserts a working masthead with **zero edits** under `features/news/**` layout code (NWS-002).
- [ ] **Category nav.** Given `OutletDto.categories`, then the nav renders "Home" plus each category as links to `/news/{outlet}` and `/news/{outlet}/section/{category}`; the current section has `aria-current="page"` and is distinguishable by weight/underline, not color alone (NFR-001); the nav is a `<nav aria-label>` with a visible focus ring.
- [ ] **Mobile-first.** Given a 360px viewport, then the masthead collapses to name + a "Sections" disclosure (keyboard- and touch-operable, ≥ 44px targets on coarse pointers) with no horizontal scroll; at ≥ 1024px the nav is a single row within the 1140px well (D3-P1).
- [ ] **No platform chrome.** The masthead renders no platform-authored text ("exercise", "preview", "sponsored") and no LIVE/BREAKING string unless it is the skin's own authorial vocabulary token (`breaking.vocabulary` / the skin's declared `liveChip`); the LIVE chip appears only when the skin declares it **and** the page opts in (it is decorative branding, not a status claim, and carries no `role="status"`).
- [ ] **Two worlds.** No COBRA import, no default MUI visual (every surface styled by CSS custom properties from `OutletSkinScope`); fonts load lazily via the foundation skin scope (`registerSkinFonts`, F13).
- [ ] **Accessibility.** The logo has non-empty `alt` (the outlet name); heading order is preserved (masthead is not the page `h1` on article pages; it is a `p`/`div` landmark region on articles and the `h1` on the home); axe has no serious/critical findings in each of the four skins.

## Out of Scope
Search; subscribe/paywall theater (epic Q2: never); cross-channel nav (shell, D7); the Scoop clutter chips (14).

## Technical Notes
Files: `src/frontend/src/features/news/masthead/{OutletMasthead,SectionNav}.tsx` (+ CSS modules + tests). Reuse `useOutletSkin`, `usePrefersReducedMotion`, `useCoarsePointer`, FontAwesome. Props only, no fetching. MUI 9 `sx`-only system props.

## Dependencies
Foundation 13 (skin scope/tokens), 02 (`OutletDto` + fixtures). Can run with 01, 05–14, 18.
