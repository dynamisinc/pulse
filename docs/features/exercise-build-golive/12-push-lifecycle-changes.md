# Story: Push lifecycle changes to connected clients (#390)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032, CTL-023, NFR-002  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.1, §10 (A5)  ·  **Issue:** —
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation)  ·  **Wave:** A5

## Context
Clients learn that an exercise paused, froze, ended or reopened only on refresh (tracker #390, [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §10). Lifecycle changes should be pushed over the existing SignalR hub.

## Acceptance Criteria
- [ ] Given any lifecycle transition or pause tier change, when it commits, then a `lifecycle.changed` message with the new state and tier is sent to that exercise's hub group only.
- [ ] Given a connected participant client, when Freeze starts, then the composer disables with an announced message; on resume it re-enables, without a page reload.
- [ ] Given a connected staff console, the state indicator updates within 2 s.
- [ ] A client that reconnects after a missed message re-reads the state before accepting input.
- [ ] A foreign-exercise and a foreign-org client never receive another exercise's lifecycle messages.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Accessibility (NFR-001): state changes are announced in a live region, text/icon plus color.
- [ ] Scenario time: any time shown in the participant message is scenario time.
- [ ] Two worlds: participant message in brand skin; staff indicator in COBRA.
- [ ] User guide (C5): `controller-guide.md` / `participant-guide.md` updated, or "no guide impact".

## Out of Scope
New channels; push notifications outside the app.

## Technical Notes
Both worlds. Hub group per exercise, `core/realtime/` feed hook, participant composer, staff header. Coordinate hub edits with 10.

## Dependencies
Wave A5, after 10 and 11.

## Tests
Hub integration test; RTL for composer disable/enable and live region; isolation tests.
