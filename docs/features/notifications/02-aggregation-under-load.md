# Story: Aggregation under load (training lever)

**Feature:** Notifications  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-071 (NFR-002)  ·  **Design decisions:** D1-005  ·  **Issue:** #118

## Context
Notification volume is a training lever: controllers/E8 can generate mention-storms. The design must
stay performant and legible under bursts (SOC-071). Per D1-005, notifications **aggregate** ("Newsline
7 and 41 others liked your post") with a one-line "High activity — similar notifications are grouped."
notice — they never overwhelm the center row-by-row.

## Acceptance Criteria
- [ ] Under high volume, similar notifications **aggregate** into a single row ("X and N others …")
      with a "grouped" notice (D1-005).
- [ ] The center stays smooth and legible at NFR-002 burst load (no jank, no unbounded row growth).
- [ ] Aggregation is an `aria-live=polite` update (NFR-001) — screen readers are not flooded.
- [ ] Aggregated rows still allow drill-down to the underlying set.

## Out of Scope
The center base UI (story 01); platform alerts (story 03); the E7/E8 storm generation.

## Technical Notes
Participant world. Aggregation buckets by (type, target) under a volume threshold. Shares the burst
strategy with the feed pill (feeds-discovery). See implementation.md (story 02).

## Dependencies
story 01 (center); NFR-002 targets; E7/E8 (storm sources).

## Tests
- Unit: notifications aggregate by type/target under threshold; component: a storm renders grouped rows,
  not thousands of rows.
