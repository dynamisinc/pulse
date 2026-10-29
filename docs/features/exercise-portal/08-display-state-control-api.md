# Story: Display state and remote-control API

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — **Deferred to post-December (Tom, 10/29, Q-35)**  ·  **Status:** Deferred (post-December)
**Requirements:** PRT-040, PRT-041, XC-001, XC-002, XC-004  ·  **Design decisions:** none (Master decision 10)  ·  **Issue:** —
**Stack:** backend  ·  **World:** foundation  ·  **Wave:** 3  ·  **Effort:** M

> **Deferred (post-December).** Tom decided on 10/29 (Q-35) that December ships the portal first and **kiosk-lite only** (the existing shared view-only login on `/portal?display=1`, using the kiosk frame, no new credential, no remote control). Per-display state and the remote-control API (pin a target, playlist, show-next, display read with ETag, connected status) moved out of December. **No GitHub issue is created for this story**; it is listed on the Portal feature issue. The text below is kept as the starting point for the post-December display-credential work; before it is scheduled, re-check it against what stories 18/19 actually shipped for kiosk-lite.

## Context
PRT-040: a facilitator chooses a surface (the portal, a feed, a specific article/post/warning), builds an auto-cycling playlist, and says "show this next". This story owns that state per display and the two sides of it: the read a screen polls and the commands a facilitator sends. December ships **5-second ETag polling** (PP-4: a per-display push group is parked). Pairs with module-based time advancement (COR-052) only through content: a clock jump publishes scheduled items and the screen shows them; no direct coupling.

## Acceptance Criteria
- [ ] **Display read.** Given a display session, when `GET /api/display/state` is called, then it returns that display's `DisplayStateDto` (mode, items, dwell, `showNext`), honors `If-None-Match` with `304`, bumps the display's `LastSeenWallClock`, and a participant, staff or other-display session gets `404`.
- [ ] **Commands.** Given a controller or planner, when they `POST /api/displays/{id}/target` (pin one target), `/playlist` (≤ 20 items, dwell 5-120 s), `/show-next` (one-shot interrupt that shows once then resumes the prior mode) or `/clear-next`, then `StateVersion` increments atomically and a stale write is `409`.
- [ ] **Targets are validated.** Given a target, then `content` must be a **published** item in this exercise (draft, scheduled, retracted, deleted and other-exercise are the same `422`, no existence leak), `post` must be a public, undeleted post in this exercise, `portal` / `feed` / `alerts` need no ref, and the `portal` kind requires the portal channel enabled.
- [ ] **Self-healing.** Given a pinned or playlist target is later retracted or soft-deleted, then the read drops it (a playlist skips it; an emptied playlist or a pinned dead target falls back to `portal`) and bumps `StateVersion`; nothing in the display read ever carries a draft or retracted body.
- [ ] **Connected status.** Given `LastSeenWallClock`, then staff `GET /api/displays` reports `connected` when seen in the last 20 s, as a boolean plus the timestamp (the UI states it in text, 20).
- [ ] **Telemetry.** Given a command, then `display_command` is emitted (PC-6) with the staff actor and `payload.command`; display reads emit nothing.
- [ ] **Isolation.** Given display B of exercise B, when exercise A's staff command names it, then it is a 404; display state never includes another display's data.

## Out of Scope
The display's rendering and player (18, 19), the staff UI (20), the credential (05), push delivery (PP-4, parked; December polls), module stepping (COR-052, exercise-clock/03).

## Technical Notes
Files: `Features/Portal/Display/Control/**`. Reuse the optimistic-`Version` pattern from `InjectQueueService`; published-content and post lookups go through F06's read services / the post projector (no direct table reads from here). Wiring test via `WebApplicationFactory<Program>`.

## Dependencies
01, 02, 05, F06 (published lookup). Can run with 09-16.
