# Story: PIO multi-column mode (grant-gated)

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-080 (monitoring-first for PIOs)  ·  **Design decisions:** D1-010  ·  **Issue:** #125

## Context
The epic's design notes floated a TweetDeck-style monitoring layout as a PIO-mode option; the D1 design
makes it concrete (D1-010): a **"Columns" nav toggle rendered only for org-grant holders**, **off by
default**. On: center + sidebar are replaced by horizontally-scrolling columns (All Posts · a saved
hashtag · a saved search · Mentions) with compact rows and suppressed action bars; the nav rail
persists; one click back.

## Acceptance Criteria
- [ ] A "Columns" toggle is exposed **only to org-grant holders** (D1-010, like the posting-as chip)
      and is **off by default** *(its nav-rail placement: interim — superseded by D7 shell,
      R-006/COMPONENTS.md — the nav rail is inventoried improvised chrome)*.
- [ ] Enabling it replaces center+sidebar with TweetDeck-style columns (All Posts, a saved hashtag, a
      saved search, Mentions @self) — compact rows, action bars suppressed; the app navigation
      remains available (nav-rail chrome itself: D7 shell).
- [ ] Column config (saved hashtag/search) persists for the user; columns are exercise-scoped (COR-001)
      and stay legible under burst (NFR-002) with the same buffering as the main feed (story 04).
- [ ] One click returns to the standard single-feed view; this is a participant (PIO) in-fiction
      setting — distinct from the staff Controller Console watchlist (E7 CTL-031).

## Out of Scope
The staff Controller Console columns (E7 live-monitoring CTL-031 — a different surface); the org-grant
model (E1 COR-018).

## Technical Notes
Participant world. Grant-gated layout mode reusing the feed + search + hashtag streams as columns. See
implementation.md (story 06). Note the parallel-but-separate E7 CTL-031 staff watchlist.

## Dependencies
stories 01/03/04 (feeds/search/real-time); posts (compact card); E1 org grants (COR-018).

## Tests
- Component (RTL): Columns toggle shows only for grant-holders, off by default; enabling renders the
  column set; one click back.
