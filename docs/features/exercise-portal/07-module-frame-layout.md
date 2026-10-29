# Story: Module frame, layout and clean hiding

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-003, PRT-020, PRT-006, NFR-001, XC-004  ·  **Design decisions:** D2-005, D2-003 (`anchor` only)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

## Context
PRT-003: a modular, planner-configurable layout whose sections for disabled channels hide cleanly; D2-005: a disabled channel removes the module **and** its link, leaving no dangling door, and the page "must look complete with any subset". This story is the registry, the grid and the section frame every module story plugs into, plus a harness that renders any subset. It is where PRT-020's discoverability lives: each module header carries a "See all →" link (in-content, not navigation chrome; see conflict C-1).

## Acceptance Criteria
- [ ] **Registry.** Given `registerPortalModule({ id, channelId, region, order, Component, DisplaySlide? })`, when a module story registers itself, then `PortalLayout` mounts it with **no change to layout code**; two modules with the same id throw at registration (a unit test).
- [ ] **Anchor layout.** Given `layoutKey: 'anchor'`, then regions are `lead` (hero + grid) and `rail` (336 px at ≥ 1024 px) via `grid-template-areas`; below 1024 px the rail folds under the lead in stored order; at 320 px everything is one column with no horizontal scroll.
- [ ] **Clean hiding (D2-005).** Given `PortalDto.modules` is any of the 2^4 subsets of the content modules (and Trending present or absent), when the layout renders, then the page looks complete: no empty frames, no orphaned headings, no dead "See all" link, and the rail collapses entirely when it has no module (a harness test renders all subsets).
- [ ] **Module frame.** Given a module, then `ModuleFrame` renders a heading (a real `h2`), an optional "See all →" link to the channel's home (only when that channel is enabled), a polite live-region slot, and a loading / empty / error treatment where **empty or errored hides the whole module** rather than showing a placeholder box (fail closed).
- [ ] **Click telemetry.** Given a module link is activated, when `ModuleFrame.trackClick(moduleId, target)` runs, then one `portal_module_click` is emitted (PC-6) and modules emit no telemetry themselves; activation never double-fires on keyboard Enter plus click.
- [ ] **Accessibility.** Given the layout, then landmarks are correct (`main`, labelled `section`s), heading order is `h1` (masthead) then `h2` per module, tab order follows reading order, touch targets are ≥ 44 px on coarse pointers, focus is visible, and axe is clean in the harness (NFR-001).
- [ ] **Two worlds.** Then no file in `layout/` imports COBRA or renders a default MUI look; spacing and type come from the skin variables with a neutral fallback.

## Out of Scope
Any module's content, `band` / `grid` layouts, per-user layout customization, drag-and-drop in the participant view.

## Technical Notes
Files: `features/portal/layout/**`. MUI 9 `sx`-only; CSS grid via `grid-template-areas`; FontAwesome icons. The harness (`renderPortalSubset(subset, fixtures)`) is exported for 09-15 and 23.

## Dependencies
02, F08 (`useEnabledChannels`), F14. Can run with 03, 04, 05, 06.
