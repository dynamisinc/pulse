# Story: Lifecycle gate for the hub and the reaction loop (#375)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032, COR-043, CTL-023  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.2 (EndEx), §9, §10 (A5)  ·  **Issue:** #375
**Stack:** backend  ·  **Review tier:** Tier-2 (isolation, correctness)  ·  **Wave:** A5

## Context
EndEx must close the hub and stop the reaction loop; today nothing gates them on lifecycle state ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.2, tracker #375). Touches `ReactionLoopHost`, which Session C also edits: coordinate on that file.

## Acceptance Criteria
- [ ] Given an exercise that is `completed` or `archived`, when the hub is joined or a hub broadcast is attempted, then it is refused/closed and live connections for that exercise are dropped.
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
Hub/loop lifecycle matrix tests; reopen restart test; isolation tests.
