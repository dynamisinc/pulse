# Story: Staff weather timeline panel

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-002, WX-003  ·  **Design decisions:** D4-011 (#9)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** staff (COBRA)  ·  **Wave:** 5  ·  **Effort:** M

## Context
WX-002's "weather timeline": planners see, per zone, what weather will play out and when, with a **now** marker on the exercise clock and manual override at any time. Scoped for December as an **ordered list
grouped by zone with a now marker** (not a lane/canvas view — see slip candidates). It is a console surface that reads story 05 and hands editing to F17/11.

## Acceptance Criteria
- [ ] **Surface and access.** Given a controller, then "Weather timeline" is a launcher-gated surface in the staff registry (orchestrator adds the entry), COBRA-styled, desktop-first, and read-only roles see it without mutating controls.
- [ ] **Per-zone ordered list.** Given the timeline read model, then items are grouped by zone (multi-zone products appear under each) and ordered by scenario time; each row shows type chip (icon + text), hazard, headline, scenario time with the wall-clock pair, status (draft/scheduled/published/retracted: text + icon + colour) and state (pending/active/expired/cancelled).
- [ ] **Now marker and live clock.** Given the exercise clock advances, jumps or is frozen, then a "Now" divider tracks the server scenario time (`ScenarioClockChanged`), rows move from scheduled to published live, and a frozen world shows "Clock frozen" so a planner understands why nothing fires; items published ahead of a rewound clock show the `ahead_of_clock` flag.
- [ ] **Override and edit.** Given a row, then "Edit", "Publish now", "Unschedule", "Retract" and the follow-up actions (update / upgrade / cancel) delegate to F17/11 and refresh the list; "Add item at…" creates a draft pre-set to a chosen scenario time; failed scheduled publishes show `lastError` with a retry path.
- [ ] **Keyboard and access.** Rows are keyboard-navigable with visible focus and shortcut hints; the list is a labelled region with a live region for new publishes; axe clean (NFR-001 evaluator/staff parity) and never color-only.
- [ ] **Isolation (XC-001).** The panel only ever shows the staff session's exercise; a stale link to another exercise's item renders not-found.
- [ ] **User guide.** Adds the weather-timeline page to `docs/guide/` or states "no guide impact".

## Out of Scope
Drag-to-reschedule lanes, bulk offset, copy-timeline-between-exercises, a printable timeline, evaluator expected-action binding to weather (E10).

## Technical Notes
Files: `src/frontend/src/features/weather/staff/timeline/**` (`WeatherTimelinePanel.tsx`, `useWeatherTimeline.ts*`). COBRA via `@/theme/styledComponents`; React Query over `GET /api/weather/timeline` (mock until live); stream via `useChannelStream`; clock via `core/clock`.

## Dependencies
05 (read model; mock until live), 11 (editors for the edit action), F17 (shell, routes), F09. Can run with 08, 09, 10, 13.
