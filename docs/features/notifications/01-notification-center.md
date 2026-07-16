# Story: Notification center & badge (typed)

**Feature:** Notifications  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-070  ·  **Design decisions:** D1-R5  ·  **Issue:** #117

## Context
An in-app notification center + badge for mentions, replies, reposts, likes, follows, and DMs
(SOC-070). Per D1, rows use typed symbols (♥ like pink / ⇄ repost green / @ mention accent / + follow
violet) and the nav bell shows a count badge (3 normal / 5 alert / 99+ burst) (D1-R5).

## Acceptance Criteria
- [ ] A notification center lists mentions, replies, reposts, likes, follows, and DMs with typed
      symbols; an unread count badge is surfaced on the app's notifications entry point *(the nav
      bell/badge placement in the rail: interim — superseded by D7 shell, R-006/COMPONENTS.md)*.
- [ ] Notifications render in scenario time (COR-053), exercise-scoped (COR-001); tapping navigates to
      the source (post/thread/profile/DM).
- [ ] Type is conveyed by symbol + text, not color alone (NFR-001).
- [ ] Observer/read-only mode leaves notifications inert (D1-011).

## Out of Scope
Aggregation under load (story 02); platform alerts (story 03); the notification sources themselves.

## Technical Notes
Participant world. Notification model spans all source types. See implementation.md (story 01).

## Dependencies
posts/threads/amplification/reactions/profiles/DMs (sources); scenario-time; telemetry.

## Tests
- Component (RTL): center lists typed notifications + badge; tapping navigates to source; symbols not
  color-only.
