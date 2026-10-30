# Story: Top Stories module

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-004, PRT-006, PRT-030, PRT-031 (consumes), COR-053, XC-001, NFR-001, NFR-002, NFR-008  ·  **Design decisions:** D2-001, D2-004, D2-008  ·  **Issue:** #773
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** L

## Context
The portal's lead: a hero story plus a card grid, each card linking to the full article on its outlet (PRT-004). Ordering is already solved by the foundation (`featured=true` → featured rank, then recency, in one query, F06); this story **composes** it: lead = first, grid = the next six, outlet source chips (the aggregator claims curation, not authorship, D2-001). Filler and crisis stories sit in the same list; the `background` tag is staff-only and never reaches the client (XC-002), so normalcy and incident look the same to the code.

## Acceptance Criteria
- [ ] **Composition.** Given `GET /api/channels/news/content?featured=true&limit=7` (via F15 `useContentList`), when the module renders, then the first item is the lead (hero 16:9, headline, dek, kicker when authored) and the next up to six are cards, each with an outlet source chip (text, the outlet name), headline, scenario dateline and optional thumbnail.
- [ ] **Fallback (PRT-004).** Given no item is featured, then the most recent published stories fill the module in recency order (the server fallback); given controllers feature a story, when the server returns it first, then it becomes the lead with no client re-sorting.
- [ ] **Links.** Given a card, when activated, then it goes to the item's `permalink` (always `/{channel}/{outlet}/{slug}`, FC-9) inside the same host; a retracted or unknown item never produces a card.
- [ ] **Live without refresh (PRT-006).** Given `ContentPublished`, `ContentRevised` or `ContentRetracted` on the news channel (F09), then the lists update: a retracted item disappears; a new story is held behind a "N new stories" control announced politely at most once per 5 s and applied on activation (or immediately when the reader is at the top), so the lead never shifts under a reader mid-scroll (NFR-002).
- [ ] **No platform text.** Given any state, then the module adds no BREAKING / EMERGENCY / "featured" / "sponsored" label: kicker, headline and dek are rendered exactly as authored data (FC-9.5, conflict C-2).
- [ ] **Scenario time and watermark.** Given dates, then every timestamp renders via `ScenarioDateline` (relative "2h ago" uses the shell's `scenarioNow`); the lead hero reserves the bottom-right EXERCISE chip and media always gets `ExerciseBands` when required (NFR-008, D2-008).
- [ ] **Empty, loading, mobile, a11y.** Given zero stories or a fetch error, then the module hides (07); at 320 px the lead stacks above a one-column list; images have authored `alt`, headings are real, targets ≥ 44 px, axe is clean.
- [ ] **Isolation.** Given the module's only data path is the host-scoped F06 route (no `exerciseId` anywhere), then a fixture for another exercise never renders (covered in 23).

## Out of Scope
Pin/reorder UI (F17, 22), outlet pages (E4), search, per-user personalization, "most read" (NWS-030 forbids reader-visible telemetry), the world-state mood (13).

## Technical Notes
Files: `features/portal/modules/topStories/**` (+ its `register.ts`, added to `modules/index.ts` by the orchestrator). Exports `useTopStories` for the kiosk portal slide (19). Reuse `ContentMedia`, `WatermarkSlot`, `ScenarioDateline`, `useChannelStream` (F09). Runs on fixtures until F06 is live.

## Dependencies
02, 07, F06, F09, F13, F14, F15. Can run with 10-16.
