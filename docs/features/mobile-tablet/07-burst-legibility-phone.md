# Story: Burst legibility at 120 posts/min on a mid-range phone

**Feature:** Phones and tablets  ·  **Epic:** E2  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** NFR-002, SOC-071  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
D0 non-negotiable 5: the feed stays smooth and readable at 120 posts/min peaks (NFR-002: 60/min sustained, 120/min for at
least 10 min). Today this has only been reasoned about on desktop. Measure on an emulated mid-range phone and fix small
frontend defects; larger findings become issues. Participant world.

## Acceptance Criteria
- [ ] Given a 4x CPU-throttled Chromium at 390x844 with touch, when `injectBurst` streams 120 posts/min for 10 minutes of accelerated mock time through the feed stream seam, then the main thread has no single long task over 200 ms attributable to feed rendering and the p95 frame time stays under 50 ms (thresholds recorded in the spec, adjustable by Tom).
- [ ] Given the burst, when the participant is scrolled down reading, then the visible post under the finger does not jump (scroll anchoring holds) and `NewPostsPill` shows an aggregated count instead of inserting rows.
- [ ] Given the burst while scrolled to the top, then newest posts appear without layout shift larger than one post height and the list's DOM node count stays bounded (windowing or capped history, documented).
- [ ] Given a screen reader, when posts arrive in a burst, then the live region announces an aggregate ("N new posts") rather than every post (NFR-001, SOC-071 aggregation).
- [ ] The result (numbers, device profile, date) is recorded in the PR description; any defect needing backend or design work becomes a new issue linked to #524. User guide: no guide impact.
- [ ] No-enterprise-look and scenario-time ACs are re-asserted on a post rendered mid-burst (`expectNoWallClock`).

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
