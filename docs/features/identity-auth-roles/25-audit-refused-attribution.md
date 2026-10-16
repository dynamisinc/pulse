# Story: Audit refused attribution attempts (#389)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-018, XC-004, NFR-009  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §10 (A5)  ·  **Issue:** #389
**Stack:** backend  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A5

## Context
`POST /api/posts` already derives identity server-side (story 12). When a caller tries to attribute a post to a persona or role they do not hold, the refusal is currently silent. A5 requires every refused attribution to be audited ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §10; tracker #389).

## Acceptance Criteria
- [ ] Given a participant or staff caller who submits a persona they are not bound to, when the request is refused, then an `identity.attribution.refused` event is recorded with the actor `PersonId`/`AccountId`, claimed persona, exercise, and wall + scenario time.
- [ ] The refusal response is unchanged and does not reveal whether the persona exists (uniform error).
- [ ] The audit write never fails the refusal and cannot be triggered by an unauthenticated caller.
- [ ] Events are visible in the controller audit/telemetry view of that exercise only; a foreign-exercise and a foreign-org attempt create no event in the victim exercise.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] User guide (C5 docs-as-done): `docs/guide/troubleshooting.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". (wrong-account diagnosis uses the audit entry).

## Out of Scope
Rate-limiting attribution attempts; new UI beyond the existing audit view.

## Technical Notes
Backend. `CurrentSessionAccessor`, `PostIngestService`, telemetry emitter. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A5, after identity 12 and A1.

## Tests
Refusal tests asserting the event; no-leak test; isolation tests.
