# Story: Explore — trending, search, hashtag polish

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** SOC-040, SOC-041 (client-side, organic), SOC-042, SOC-082 (lite), SOC-052, NFR-001  ·  **Design decisions:** D1-R1, D1-008 (the platform never flags a lookalike)  ·  **Issue:** #434
**Story ID:** F6  ·  **Stack:** frontend  ·  **Priority:** Should  ·  **Effort:** M  ·  **Wave:** 2  ·  **Cut line 2:** search is cut before trending
**Home stories:** [`hashtags-trending/02`](../hashtags-trending/02-organic-trending.md) (lite), [`feeds-discovery/03`](../feeds-discovery/03-search.md) (lite).

## Context
**As** a PIO, **I want** a Trending panel, an Explore page and a search box that finds posts and people, **so
that** I can see "#WaterIssues" trending and find the verified agency next to its unverified lookalike (demo
beat 1). Smallest scope: everything is computed **client-side over the loaded newest-200 feed** and the persona
cast — no new endpoint. **World: participant** — no COBRA/MUI.

## Acceptance Criteria
- [ ] **Trending is organic.** `TrendingPanel` lists the top 5–10 hashtags from the loaded feed, weighted by
      recency in **scenario** time (windowed from `scenarioNow()`), with a post-count line and a varied category
      label ("Trending", "Public safety · Trending"); nothing is declared manually; soft-deleted posts never
      contribute. The computation is a pure, memoized function with a deterministic tie-break (unit-tested).
- [ ] **Explore page.** `/explore` (F1's route; replaces F0's `ExplorePage` stub) shows the search box and the
      trending list; activating a trend navigates to `/hashtag/:tag`.
- [ ] **Search (posts + people).** `SearchBox` filters the loaded posts (text and hashtag match) and the persona
      cast (name, handle) with a Top/Recent toggle (Recent = scenario time desc; Top = engagement desc); the
      **People** section shows a verified agency and its unverified lookalike **side by side with identical
      treatment except the seal** (SOC-052/D1-008 — no "official"/"unverified" label, no machine-readable tell).
- [ ] **Hashtag page polish.** `HashtagFeed` gets a header (tag + post count) and Top/Recent tabs (SOC-040) and
      an honest empty state; cards keep working (live actions come from `PostCard`).
- [ ] **Accessibility (NFR-001).** The box is `role="search"` with a visible label; result counts are announced
      in a polite live region; the lists are keyboard-navigable; "no results" is text, not color.
- [ ] **Scenario time only.** Windows and relative times derive from scenario time; no wall-clock display or
      computation.

## Out of Scope
Server-side search/trending, recents/saved searches, boost-weight lever (SOC-041's controller half), a results
page distinct from Explore, advanced operators, topic categories from data, ranking beyond the Top/Recent
toggle.

## Technical Notes
- Files: implementation.md §4.1 row F6 — `social/explore/**` (new `TrendingPanel`, `SearchBox`, `ExplorePage`,
  `trending.ts`, `search.ts`), `pages/HashtagFeed.*`. The orchestrator mounts `SearchBox`/`TrendingPanel` into
  F1's `RightRailContent.tsx` after both merge — build them as self-contained components that read the
  feed/persona hooks themselves (`useFeed`/`resolveFeed`, `usePersonas`), no props from the rail.
- Reuse `utils/hashtags.ts` (`parseHashtags`), `useFeed`, `assembleFeedView`; do not edit `Feed.tsx`. The
  persona list for People comes from `usePersonas()` (participant projection — no `personaType`).

## Dependencies
F0. Runs with F1–F5. No backend. Cut line 2 (Mon 10/12): if Wave 2 is behind, drop search and keep trending.

## Tests
- `trending.test.ts`: windowing in scenario time, recency weighting, tie-break determinism, deleted/empty feed,
  burst of 200 posts.
- `search.test.ts`: post/hashtag/people matching, Top vs Recent ordering, the lookalike pair renders with
  identical structure except the seal (no extra attribute that distinguishes them).
- Component tests for `TrendingPanel`, `SearchBox` (live region, keyboard), `HashtagFeed` tabs/empty state.
