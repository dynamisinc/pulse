# Story: Social Stream and Trending modules

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-005, PRT-003 (Trending), PRT-006, XC-001, COR-053, NFR-001, NFR-002  ·  **Design decisions:** D2-005, D2-006  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant (portal rail, Pulse brand scope inside it)  ·  **Wave:** 3  ·  **Effort:** L

## Context
PRT-005: a live-updating sample of recent public posts with deep links into E2 (post → thread, account → profile), plus Trending (PRT-003) in the rail. The Pulse rail uses Pulse's own look (canonical seal, social brand scope, D2-006) inside the portal's aggregator page. It is also the **burst-legibility** surface of the portal: at 120 posts/min the stress is the training, jank is not (D0 §4.5, NFR-002).

## Acceptance Criteria
- [ ] **Excerpt.** Given the host-scoped public feed (R-S1 `useRecentPublicPosts`), when the module renders, then it shows the latest five top-level public posts (no replies, no deleted/hidden, no DMs) using the social `PostCard` presentational parts with **all affordances absent** (no composer, reply, react, follow; COR-015 pattern), inside `SocialBrandScope`.
- [ ] **Deep links (PRT-005).** Given a post or author, when activated, then post → `socialPostPath(id)` (thread) and author → `socialProfilePath(handle)` (R-S1) inside the same host; the module never reaches into social routes by string.
- [ ] **Burst-safe.** Given a feed arriving at 120 posts/min, when the module renders, then it keeps a **fixed footprint** (five slots, no height change), applies at most one visual update per 4 s showing the newest five, uses a short fade (none under `prefers-reduced-motion`), never moves a post under the pointer or focus, and a bench test shows no more than one commit per update tick and zero layout shift.
- [ ] **Pause (WCAG 2.2.2).** Given auto-updating content, then a visible, keyboard-operable "Pause updates" / "Resume" control stops and restarts updates; the region is `aria-live="off"` (posts are never announced one by one) with one polite summary at most every 30 s.
- [ ] **Trending.** Given `useTrending` (R-S1), then the top five topics render as chips (text, never color-only) linking to the social explore/search destination; the module hides when `social` is disabled (no data source, conflict C-3) and when there are no topics.
- [ ] **Scenario time.** Given post times, then they render through the social formatter / `ScenarioDateline` (COR-053); no wall clock.
- [ ] **Isolation and no new path.** Given the module, then its only data is the existing exercise-scoped feed (`GET /api/feed` + the live stream), so a cross-exercise post cannot appear; no portal-owned endpoint exists.
- [ ] **Mobile and a11y.** Given 320 px, then the module is full-width under Top Stories, targets ≥ 44 px, headings and axe are clean.

## Out of Scope
Composing, reacting or replying from the portal, personalized feeds, a portal-owned trending algorithm (SOC-041/042 own it), moderation.

## Technical Notes
Files: `features/portal/modules/socialStream/**`. Exports `useSocialExcerpt` for the kiosk feed slide (19). **R-S1 is resolved by foundation story 21**: import `useTrending`, `useRecentPublicPosts`, `SocialBrandScope`, `socialPostPath`/`socialProfilePath` and the read-only `PostCard` from the `features/social` barrel; no adapter file and no deep imports. Reuse the existing explore baseline / feed store so no second feed subscription is opened.

## Dependencies
02, 07, **F21** (R-S1), F15. Can run with 08, 09, 11-16.
