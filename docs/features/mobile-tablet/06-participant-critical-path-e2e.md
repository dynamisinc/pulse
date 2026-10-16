# Story: Participant critical-path e2e at 360/390/768

**Feature:** Phones and tablets  ·  **Epic:** E2  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** XC-004, NFR-001, COR-053  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
The brief asks for Playwright viewport tests of the participant critical path: join -> feed -> post -> reply. First
browser e2e specs (counts toward track 7). They run against the frontend mock seams, no backend, at 360, 390 and 768.

## Acceptance Criteria
- [ ] Given the join link and the day-word sign-in at each of 360/390/768, when the participant completes it, then they land on the Social feed (pilot mode: login lands on the feed).
- [ ] Given the feed, when the participant opens the composer, types text and taps Post, then the new post appears at the top of the feed under their persona with a scenario-time stamp, and the composer closes.
- [ ] Given a post in the feed, when the participant opens its thread, types a reply and sends, then the reply appears in the thread and the reply count updates.
- [ ] Given each step, then `expectNoHorizontalScroll` passes and the primary actions are at least 44px (`expectTouchTargets`).
- [ ] Telemetry (XC-004): the post and reply steps each emit the corresponding telemetry event through `core/telemetry` (asserted by intercepting the mock emitter), with wall time, scenario time, actor and channel.
- [ ] Isolation (XC-001): after sign-in, a request for another exercise's thread id (mock seam) renders the not-found state, not foreign content.
- [ ] User guide: no guide impact (tests); the spec list is referenced in `tools/guide-screenshots/README.md` via story 01's pointer.

## Out of Scope
Backend integration, likes/reposts/follow (covered by unit tests), controller flows (story 16), cross-browser matrix.

## Technical Notes
`src/frontend/e2e/participant-critical-path.spec.ts` using the story 01 kit; Chromium only; one `test.describe` per viewport.
If mock seams cannot satisfy a step, file the gap rather than adding product code. See `implementation.md` story 06.

## Dependencies
Stories 01, 02, 03 (flows must be usable at phone sizes).

## Tests
The spec is the deliverable; it must pass 3x consecutively (flake check) before merge.
