# Story: Audit refused attribution attempts (#389)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-018, XC-004, NFR-009  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §10 (A5)  ·  **Issue:** #389
**Stack:** backend  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A5

## Context
`POST /api/posts` already derives identity server-side (story 12). A participant's body-supplied persona is **ignored**, not refused (a stale client or mid-exercise rebinding is a client bug), and a staff session may select any in-exercise persona (`PostAttributionResolver.cs` ~180-194, 267-270); story 12 preserved that and this story does not change it. What *is* refused is a participant (non-staff) session **claiming a privileged origin** (`controller-as-persona`, `inject`, `engine`; ~237-242, 403), and that refusal is currently silent. #389 requires it to be audited ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §10; tracker #389).

## Acceptance Criteria
- [ ] Given a participant session whose request body claims a privileged origin (`controller-as-persona`, `inject` or `engine`), when the request is refused (403), then an `identity.attribution.refused` telemetry event is recorded with the **claimed origin**, the actor account (`AccountId`, and the acting human), the outcome (`refused`), the exercise, and wall + scenario time. Participant persona mismatches and staff persona choices are not refusals and emit no such event; the persona-ignore and staff-any-persona behavior is unchanged (regression test).
- [ ] The refusal response is unchanged and reveals nothing beyond today's message (no persona or account lookups are exposed).
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
Refusal tests asserting the event for each claimed origin; regression tests that a participant persona mismatch is still ignored (no event) and staff may still pick any in-exercise persona; no-leak test; isolation tests.

### Copilot review 3 fold (2026-10-16)
- Changed: Context and audit AC rewritten. Persona mismatch (participant, ignored) and staff persona choice are unchanged behavior; the audited refusal is a participant claiming a privileged origin, with the claimed origin, actor account and outcome recorded. Issue #389 context is consistent (title "Audit refused attribution attempts" still holds: the refused attempts are the privileged-origin claims).
