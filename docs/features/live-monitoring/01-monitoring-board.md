# Story: Monitoring board — live participant activity

**Feature:** Live monitoring  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-030  ·  **Design decisions:** none  ·  **Issue:** #30

## Context
The controller's situational awareness: a live stream of participant activity — posts, (later)
releases, DMs, article views — filterable by participant, org, and channel (CTL-030). This is
**operational awareness, not scoring** (evaluation analytics are E10).

## Acceptance Criteria
- [ ] Given live conduct, when the console renders the monitoring board, then it streams participant
      activity in near-real-time (posts in Phase 1; DMs/views/releases as those channels land) with
      actor, channel, and scenario time (COR-053).
- [ ] The board filters by participant, org, and channel, and updates live without manual refresh
      (SignalR, falling back to polling if the real-time channel degrades — NFR-003).
- [ ] The stream stays legible under burst (NFR-002 / SOC-071) — high volume aggregates or virtualizes
      rather than janking.
- [ ] The board is scoped to the active exercise (COR-001), is staff-only (XC-002), and has specified
      live-region behavior for screen readers (NFR-001).

## Out of Scope
Watchlist columns (story 02); expected-action tracking (story 03); the queue-pressure meter (story
04); evaluation scoring/metrics (E10); DM/article-view sources that don't exist until their channels
land.

## Technical Notes
Staff world (COBRA). Reads the XC-004 telemetry/activity stream (mockable now); virtualized list for
burst. Continuous-watch column mounted in console-shell. See implementation.md (story 01).

## Dependencies
console-shell (column host); the XC-004 activity stream / SignalR host; E2 posts as the Phase-1
source.

## Tests
- Component (RTL): the board streams activity and filters by participant/org/channel.
- Unit: burst input virtualizes/aggregates without dropping items; times render in scenario time.
