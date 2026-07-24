# Story: Real-time role-scoped groups — keep staff-only pushes off participant connections

**Feature:** Social API  ·  **Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** XC-002, SOC-052, COR-001 (COR-018, NFR-003)  ·  **Design decisions:** none  ·  **Issue:** #346

> **SECURITY / training-integrity.** Must-fix before REAL participants. It is acceptable only transiently on a team-only UAT smoke test.

## Context
The `ExerciseRealtimeHub` (social-api/03, #272) is SHARED by the participant feed and the staff controller cockpit, and every connection joins ONE group per exercise (`exercise:{id}`). Both broadcasters fan out to that single group: `PostReceived` (participant-safe) and `ReviewItemChanged` (STAFF-ONLY: unpublished engine drafts plus provenance). Hub connections are anonymous today (no session token; the hub resolves scope by host), so the hub cannot tell a controller from a participant, and a participant's connection therefore RECEIVES `ReviewItemChanged`. Unpublished engine draft content is delivered into participant browsers (WebSocket-frame / devtools-visible, even if never rendered), which breaks XC-002 (engine provenance is hidden from participants) and the SOC-052 "is this real or simulated?" training signal.

This was latent while the hub aborted every connection (the `OnConnectedAsync` scope bug). Fixing that abort makes the hub actually deliver, which EXPOSES this leak. It is acceptable transiently on the UAT team smoke test; it MUST be fixed before real participants.

## Acceptance Criteria
- [ ] Staff hub connections are AUTHENTICATED: the controller console's SignalR connection presents the staff session (e.g. an `accessTokenFactory`), and the hub verifies the staff role from the authenticated session, never from client-asserted input.
- [ ] `ReviewItemChanged` (and any future staff-only real-time event) is broadcast ONLY to a staff-scoped group (e.g. `exercise:{id}:staff`) that a connection joins ONLY once the hub has verified staff role for that exercise. A participant connection never joins it and never receives the payload.
- [ ] `PostReceived` (participant-safe) continues to reach the exercise-wide group (participants and staff).
- [ ] Exercise isolation preserved (COR-001): a staff connection joins the staff group ONLY for its own exercise; no cross-exercise staff delivery.
- [ ] A participant or unauthenticated connection can NEVER receive a staff-only event, verified by test: the XC-002 boundary is enforced server-side, not merely by the client omitting a handler.

## Out of Scope
- The host-based exercise-scope resolution for the connection (fixed by the hub `OnConnectedAsync` scope-resolution change in this rollout); this story adds the ROLE dimension on top.
- Azure SignalR Service migration (a transport concern, not this authorization boundary).

## Technical Notes
The connection is a shared singleton per browser (`core/realtime/connection.ts`), so a given browser is either a controller or a participant; a staff `accessTokenFactory` on that connection lets the hub read the authenticated role once. Add a staff sub-group join in `OnConnectedAsync` gated on a server-verified staff role, route `EngineReviewBroadcaster` to `exercise:{id}:staff`, and leave `SignalRFeedBroadcaster` on the exercise-wide group. Session auth already runs on the connection request (`UseSessionAuthentication`); the piece missing is threading the token onto the hub connection and reading the role in the hub.

## Dependencies
social-api/03 (#272, the hub this refines); the identity/session layer (the authenticated staff role the hub must verify); the hub `OnConnectedAsync` scope-resolution fix (this rollout), which makes delivery work and exposes the need for role separation.

## Tests
- A participant / anonymous connection joins only `exercise:{id}` and receives `PostReceived` but NOT `ReviewItemChanged`.
- A staff connection joins `exercise:{id}` plus `exercise:{id}:staff` and receives both.
- Cross-exercise: a staff connection for exercise A never receives exercise B's staff events.
