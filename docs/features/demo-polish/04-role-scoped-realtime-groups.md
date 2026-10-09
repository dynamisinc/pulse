# Story: Role-scoped realtime groups

**Feature:** Demo polish  ·  **Epic:** E2 / E7  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** XC-002, SOC-052, COR-001, NFR-003  ·  **Design decisions:** D1-008  ·  **Issue:** #423 (home story is #346)
**Story ID:** B5  ·  **Stack:** backend  ·  **Priority:** Should  ·  **Effort:** M  ·  **Wave:** 1  ·  **Review:** Tier-2 (Tom)
**Home story:** [`social-api/05`](../social-api/05-realtime-role-scoped-groups.md) (slice: server side; the frontend already presents the token).

## Context
**As** the platform owner, **I want** staff-only realtime events to reach staff connections only, **so that** an
engine draft that has not been published is never visible in a participant's browser devtools (a two-worlds
leak). Today `EngineReviewBroadcaster` sends `ReviewItemChanged` to the same `exercise:{id}` group every
participant joins (`EngineReviewBroadcaster.cs:73`, `ExerciseRealtimeHub.cs:76`). Backend only:
`core/realtime/connection.ts` already sends the session token (`?access_token=` is accepted under `/hubs`), so
no frontend change is needed — but the controller console must reconnect after the deploy.

## Acceptance Criteria
- [ ] **Role verified server-side.** Given a hub connection, when it connects, then the hub decides "staff" only
      from the connection's authenticated session (a live staff-kind session assigned to the host-resolved
      exercise) — never from a query value, header or client message. There is still **no client-invocable
      method that accepts a group name or exercise id**.
- [ ] **Staff group.** A verified staff connection joins `exercise:{id}` **and** `exercise:{id}:staff`;
      participant, shared read-only and any non-staff session join only `exercise:{id}`. The staff group name is
      derived server-side from the same exercise the connection's group join uses.
- [ ] **Staff-only events go to the staff group only.**
      `EngineReviewBroadcaster.BroadcastReviewItemChangedAsync` sends to `exercise:{id}:staff`. A participant
      connection never receives `ReviewItemChanged` (asserted on the wire, not by the client ignoring it).
- [ ] **No regression.** `PostReceived` still reaches every connection in `exercise:{id}` (participants **and**
      staff); `IFeedBroadcaster`/`SignalRFeedBroadcaster` are untouched by this story.
- [ ] **Isolation (always-Critical, COR-001).** A staff connection for exercise A never receives exercise B's
      staff or participant events, and a staff session whose assignment does not include the resolved exercise
      gets no staff group.
- [ ] **Fail closed.** An unresolved host exercise still aborts the connection; an invalid/expired token yields
      a participant-or-rejected connection, never staff.

## Out of Scope
Azure SignalR Service migration; per-user presence; any new event; making the hub reject anonymous connections
(already done by the default-deny policy); frontend changes.

## Technical Notes
- Staff-infrastructure; no UI. Files: `Features/Realtime/ExerciseRealtimeHub.cs` (+ `StaffGroupNameFor` helper
  next to `GroupNameFor`), `Features/EngineRuntime/EngineReviewBroadcaster.cs`, `RealtimeExtensions.cs` only if
  registration changes. Read the session from `Context.GetHttpContext()` (SignalR's own DI scope does not carry
  the request's `IExerciseContext` — see the existing hub remarks); reuse
  `ICurrentStaffSessionAccessor`/`StaffAssignmentService` semantics rather than inventing auth.
- **Do not touch `IFeedBroadcaster.cs` / `SignalRFeedBroadcaster.cs`** — B6 (Wave 1b) is their only editor.
- UAT consequence: after deploy, the console's hub connection must be re-established (a page refresh) to land in
  the staff group; note it in the deploy checklist.

## Dependencies
None for the build (independent of I1, B1, F0). Should merge before B6 (both live under `Features/Realtime`).

## Tests
- `Pulse.WebApi.Tests/Features/Realtime/ExerciseRealtimeHubIsolationTests.cs` (extend or sibling): participant
  never receives `ReviewItemChanged`; staff receives both; cross-exercise staff isolation; non-assigned staff
  gets no staff group.
- New `Features/EngineRuntime/EngineReviewBroadcasterScopeTests.cs`: the broadcaster targets the staff group
  name.
- Regression: existing `ExerciseRealtimeHubTests`, `SignalRFeedBroadcasterTests` green.
