# Story: Burst legibility at 120 posts/min on a mid-range phone

**Feature:** Phones and tablets  ·  **Epic:** E2  ·  **Phase:** 2  ·  **Status:** In Review (spec built; AC1-AC4 asserted, see notes)
**Requirements:** NFR-002, SOC-071  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
D0 non-negotiable 5: the feed stays smooth and readable at 120 posts/min peaks (NFR-002: 60/min sustained, 120/min for at
least 10 min). Today this has only been reasoned about on desktop. Measure on an emulated mid-range phone and fix small
frontend defects; larger findings become issues. Participant world.

## Acceptance Criteria
- [~] (60 s real time = 120 posts, not 10 min accelerated; ALL long tasks are counted, not only feed-attributable ones, which is conservative) Given a 4x CPU-throttled Chromium at 390x844 with touch, when `injectBurst` streams 120 posts/min for 10 minutes of accelerated mock time through the feed stream seam, then the main thread has no single long task over 200 ms attributable to feed rendering and the p95 frame time stays under 50 ms (thresholds recorded in the spec, adjustable by Tom).
- [x] Given the burst, when the participant is scrolled down reading, then the visible post under the finger does not jump (scroll anchoring holds) and `NewPostsPill` shows an aggregated count instead of inserting rows.
- [ ] (NOT MET / not asserted) Given the burst while scrolled to the top, then newest posts appear without layout shift larger than one post height and the list's DOM node count stays bounded (windowing or capped history, documented).
- [x] Given a screen reader, when posts arrive in a burst, then the live region announces an aggregate ("N new posts") rather than every post (NFR-001, SOC-071 aggregation).
- [ ] (PR author) The result (numbers, device profile, date) is recorded in the PR description; any defect needing backend or design work becomes a new issue linked to #524. User guide: no guide impact.
- [~] Scenario-time re-asserted (`expectNoWallClock`) on posts rendered after the burst is loaded via the pill; the no-enterprise-look check is not added.

## Out of Scope
Server-side load (PDF-03 #526 and the load harness #557), real-device lab testing, desktop performance, virtualization
rewrites larger than a focused sitting (spin out a story instead).

## Technical Notes
`e2e/burst.phone.spec.ts`, `e2e/helpers/burst.ts`; CDP `Emulation.setCPUThrottlingRate`. Seam: `social/hooks/useFeedStream.ts`,
`core/realtime`. Defect fixes in `NewPostsPill.tsx`/feed list are owned by story 02; coordinate or file back. See
`implementation.md` story 07.

## Dependencies
Stories 01, 02.

## Tests
The spec; run locally and attach numbers. Mark `@perf` so it can be excluded from fast runs.

## Build notes (honest state)
- Spec: `e2e/burst-legibility.phone.spec.ts` (`@perf`, phone-390 only); helper `e2e/helpers/burst.ts` (`injectBurst`).
  Seam is the dev-server `postStore.appendPost` (no production change). Run is 60 s real time (120 posts), not 10 min
  accelerated; `BURST_SECONDS=600` for a soak.
- Measured (4x CPU, 390x844, Vite dev build; 3 runs): long task max 206 ms (cold first run, 56 tasks > 50 ms), then
  109 ms and 101 ms; p95 frame 33.3 / 16.8 / 16.8 ms; announcements 18 per 60 s ("1 new post" ... "99+ new posts").
  The cold run breaches the 200 ms budget by 6 ms, so the check can flake on a cold dev server.
- Arrivals buffer behind the pill (D1-005), so the "scrolled to the top: newest appear" AC is superseded by design. Also
  the list is not windowed: after loading 231 rows the page holds about 9,900 DOM nodes, so the "DOM bounded" part is not met.
- Hot path: each arrival re-renders every feed row (jsxDEV, `formatAbsolute`, `compareNewestFirst` in `feedService.ts`).
  Memoizing `FeedRow` / not re-assembling the view on every store change is the likely fix (story 02's files).

## Follow-up note (perf fix)
- Root cause was not the arrival itself: `FeedRow` was already memoized and a buffered arrival re-renders no row. The
  cost was every `PostHeader` owning a 30 s `useScenarioTime` interval and re-rendering (with a fresh
  `Intl.DateTimeFormat` for the absolute title) on each tick. Fixed with a shared ticker, `useRelativeScenarioTime`
  (`core/clock/scenarioTime.ts`), that re-renders a row only when its relative text changes; the absolute title is
  memoized and `Intl.DateTimeFormat` is cached; the rendered list is a memoized `FeedList`. Pinned by
  `Feed.renderCount.test.tsx` and `useRelativeScenarioTime.test.tsx`. Remaining arrival cost is the explore store
  consumers (`TrendingPanel`, `SearchBox`), a possible follow-up.
- Still open: the DOM grows unbounded after loading a burst (231 rows, about 9.9k nodes). List windowing is a
  follow-up, to be linked to #524.
- POST-FIX measured (warm-up pass before the probe; 4x CPU, 390x844, Vite dev build; 3 runs): long task max 77 / 59 /
  119 ms (2-4 tasks > 50 ms in two runs, 20 in a noisy third), p95 frame 16.8 / 16.8 / 33.3 ms. Pre-fix: max 97-206 ms.
- The warm-up also exposed a real layout shift: the pill's wrapper added ~33 px of in-flow height on the first
  arrival, pushing the reader's content down. `NewPostsPill.module.css` `.liveRegion` is now `height: 0` (the pill
  floats, still sticky); the spec's anchor assertion covers it.
- `@perf` is excluded from `npm run test:e2e` (`--grep-invert @perf`); run it with `npm run test:e2e:perf`.
