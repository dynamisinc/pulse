# Story: Lifecycle gate for the hub and the reaction loop (#375)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032, COR-043, CTL-023  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.2 (EndEx), §9, §10 (A5)  ·  **Issue:** #375
**Stack:** backend  ·  **Review tier:** Tier-2 (isolation, correctness)  ·  **Wave:** A5

## Context
EndEx must close the hub and stop the reaction loop; today nothing gates them on lifecycle state ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.2, tracker #375). Touches `ReactionLoopHost`, which Session C also edits: coordinate on that file.

## Acceptance Criteria
- [ ] Given an exercise that is `completed` or `archived`, when a participant joins the hub, then the join is refused; and when a **simulation-content** broadcast (posts, reactions, engine output, injects) is attempted, then it is refused. Simulation-content broadcasts are also refused when the exercise is not `live`/`staged`, and under paused/Freeze as the policy in story 11 says.
- [ ] **Lifecycle/overlay control messages are never gated.** `lifecycle.changed` and the Freeze overlay message are always delivered to the exercise's group regardless of state, including after completion (story 12).
- [ ] **EndEx ordering:** commit the transition, then broadcast `lifecycle.changed` to all of the exercise's connections, then disconnect **participant** connections. Staff connections stay connected so the console observes reopen; participant clients reconnect-and-re-read on reopen.
- [ ] Given EndEx, then `ReactionLoopHost` stops ticking for that exercise within one interval and does not restart until a controller reopens it.
- [ ] Given `build` or `staged`, the loop does not run; given `live`, it runs; given a pause tier, behavior follows #379 (story 11).
- [ ] The gate reads the lifecycle state from one shared accessor, not per-call copies, and fails closed on an unknown state.
- [ ] A foreign-exercise and a foreign-org connection attempt to the hub get no events and no information about another exercise.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] User guide (C5): "no guide impact" stated, or `controller-guide.md` notes that EndEx stops activity.

## Out of Scope
Engine autonomy policy (Session C); the pause tiers themselves.

## Technical Notes
Backend. `ReactionLoopHost`, SignalR hub, lifecycle accessor. Coordinate with Session C. Orchestrator clearance for `Program.cs` lines.

## Dependencies
Wave A5, after A3 (EndEx/reopen semantics) and A1.

## Tests
Hub/loop lifecycle matrix tests (simulation-content broadcast refused vs `lifecycle.changed` delivered after EndEx; EndEx order: commit, broadcast, disconnect participants, staff still connected and sees reopen); reopen restart test; isolation tests.

### Copilot review 3 fold (2026-10-16)
- Changed: the post-completion gate refuses simulation-content broadcasts only; lifecycle/overlay control messages are always delivered. Added the EndEx ordering AC (commit, broadcast, disconnect participants; staff stay) and matching tests; aligned with story 12.

### Send-side gate fold (2026-10-19, #375 / PR #653)
Status stays **Not Started / in progress**. This fold does not complete the story.
- **Done (send side of AC1):** simulation-content hub frames are refused for participants outside `staged`/`live`/`paused`. `SignalRFeedBroadcaster` checks `ExerciseLifecycleStates.IsLivePushOpen` (the one shared accessor; fails closed on unknown or missing) before each `PostReceived`/`PostRemoved`/`PostPinChanged`/`PostEdited`/`PostEngagementChanged`. In `build`/`completed`/`archived` the frame goes to the staff group only, so consoles keep their live view. Tests: `SignalRFeedBroadcasterTests`, `ExerciseRealtimeHubLifecycleTests` (including a real-reader EndEx and a reconnect-after-EndEx case).
- **Decision, pending Tom's confirmation:** the hub **connect** stays OPEN after `completed`/`archived`, which departs from AC1's "the join is refused". The reason: the participant overlay client re-GETs `/api/overlay-state` on reconnect to render the EndEx overlay, and refusing the join would break that recovery path. The send-side gate closes the content-leak risk instead.
- **Moved:** the `ReactionLoopHost` tick-stop AC ("stops ticking within one interval") is tracked by **#640**. The EndEx ordering / participant-disconnect and overlay AC is tracked by **#390 / PR #651**.
