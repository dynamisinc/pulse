# Story: Outlet home page (lead story, sections, latest list)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-003, NWS-002, NWS-012, NWS-015, COR-053, NFR-001, NFR-002  ·  **Design decisions:** D3-P1, D3-P2 (layout enums)  ·  **Issue:** #732
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-2  ·  **Effort:** L

## Context
A scaled-down real news site per outlet: **lead story, category sections, latest list** (NWS-003), under the outlet's masthead. D3-P2 makes the lead presentation a skin **layout enum**
(`video-lead | text-lead | list-lead | clutter`) plus rail on/off, with `clutter` legal for The Scoop only. Homepage compositions per skin are full-mockup work (D3 status caveat): this story builds
the structure and the enum behaviors, not final pixel art. It also exports `StoryList`/`StoryRow`/`LeadStory` used by section pages (16).

## Acceptance Criteria
- [ ] **Content set (NWS-003).** Given `useContentList({ channel: 'news', outlet })`, then the home shows the lead story, one block per outlet category (latest 3–4 each, hidden when empty), and a "Latest" list, newest-first by `publishedScenarioTime`; draft/scheduled/retracted items never appear; an outlet with no stories shows an in-fiction empty state in its voice.
- [ ] **Lead selection.** Given `featured=true` results (foundation PRT-004 fallback ordering), then the lead is the outlet's top-ranked featured article, else the most recent; a `Background` item is never distinguished (participants cannot tell filler from scenario content, XC-002).
- [ ] **Lead modes.** Given `skin.layout.homeLead`: `video-lead` leads with a video hero if the lead has one (player thumbnail with play affordance, no autoplay), else falls back to `text-lead`; `text-lead` leads with headline + dek; `list-lead` renders a headline list with no hero; `clutter` is honored **only** for the tabloid key (14), otherwise it falls back to `text-lead`. A test per mode asserts the structure and the Scoop-only guard.
- [ ] **Rail.** Given `layout.rail: true`, then a 340px rail (latest/other sections) renders beside the main column ≥ 1024px and folds below it on mobile; `false` omits it; the rail never contains platform widgets or telemetry-derived content.
- [ ] **Breaking on home.** Given the lead article has `payload.breaking`, then the shared `BreakingBanner` (07) renders above the lead with the skin's vocabulary; otherwise nothing appears (no platform badge).
- [ ] **Live and burst legibility (NFR-002).** Given `ContentPublished`/`ContentRetracted`/`ContentRevised` (foundation 09/15), then new stories do **not** jump the list under the reader: a "N new stories" polite control (coalesced ≤ 1 announcement per 5 s via `LiveRegionAnnouncer`) merges them on activation, except at scroll top where they merge in place; a burst of 30 publishes in a minute stays smooth (virtualized/limited render, perf test) and a retracted story disappears from every block.
- [ ] **Scenario time, isolation, a11y.** Times render via `ScenarioDateline` only (COR-053); the data is the exercise-scoped participant list (no exercise id in URL, cross-exercise outlet slug → not-found, XC-001/002); one `h1` (outlet name or "Top stories"), correct landmarks, 44px targets on coarse pointers, mobile-first single column, axe clean in all four skins (NFR-001, #680).

## Out of Scope
Search; pagination UI beyond "Load more" cursor; the portal's cross-outlet Top Stories (E3); per-skin final homepage art (full-mockup deliverable); personalization or "most read" (needs reader-visible telemetry; forbidden by NWS-030 invisibility).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/home/{OutletHome,LeadStory,StoryList,StoryRow,CategoryBlock,Rail}.tsx` + tests. Presentational over `ChannelContentListDto`/`OutletDto`; the container is in 02. `StoryList`/`StoryRow` are exported for 16. MUI 9 `sx`-only; CSS modules for skin tokens.

## Dependencies
E4 03, 07 (banner), 14 (clutter), 10–13 (skins for tests); foundation 13, 14, 02 (fixtures), 15 and 09 (live merge; mock until live). Can run with 04, 19.
