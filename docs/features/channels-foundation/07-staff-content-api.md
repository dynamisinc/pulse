# Story: Staff content write API

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-013, NWS-020 (API side), NWS-022, PRS-020, PRS-005, WX-012, PRT-004 (feature/pin), PRT-031, XC-004, XC-006  ·  **Design decisions:** D4-002, D4-011  ·  **Issue:** #703
**Stack:** backend  ·  **World:** staff  ·  **Wave:** 3  ·  **Effort:** M

## Context
The staff-facing surface over the funnel: list/create/edit drafts, publish now, schedule, retract, restore, revise, feature, soft-delete and preview. Controllers can publish
as any outlet (PRS-020) and any content kind; channels add kind validation, not endpoints.

## Acceptance Criteria
- [ ] **Staff-only.** Every `/api/content-items*` route requires a live staff session (`EngineCockpitStaffAuthorizationFilter`; mutations also the controller-role filter); participant and anonymous callers get 401/403, and cross-exercise ids are indistinguishable from unknown (404).
- [ ] **List/read.** `GET /api/content-items?channel=&status=&outlet=&kind=` returns `ChannelContentStaffDto` rows in all statuses (drafts, scheduled, published, retracted), newest first, so a console can poll; `GET /api/content-items/{id}` returns one.
- [ ] **Create/edit.** `POST` creates a draft and `PUT` edits it with `version`; accepted only while `draft` or `scheduled` (a published item changes via `revise`); stale version → 409; validation failures are a readable 400 (kind payload, media ids in scope, outlet in scope and of the right channel).
- [ ] **Actions.** `publish`, `schedule` (`{ scenarioTime, options? }`, must be ≥ now; the options are persisted for replay, FC-7a), `unschedule`, `retract`, `restore`, `revise` (`{ kind: update|correction|silent_rewrite, note?, fields, touchUpdatedStamp? }`, default `true`) and `feature` (`{ rank|null }`) call `IContentPublishService`; illegal transitions → 409 with current state. `publish` accepts `PublishOptions` (`alert`, `pairedPost`). `POST /api/content-items/feature/reorder` `{ ids[] }` sets the featured order atomically (portal FU-8): all ids must be published items in the exercise, a stale or unknown id is a 409/404 with nothing applied.
- [ ] **Acting human.** The acting human is the staff session user (the `ICurrentStaffSessionAccessor` pattern), never the body; `origin` is `controller`.
- [ ] **Preview.** `GET /api/content-items/{id}/preview` returns the **participant** DTO for any status so the console renders exactly what a participant would see (COR-041), including drafts.
- [ ] **Soft delete.** `DELETE` soft-deletes (XC-010); a deleted published item also fires `ContentRetracted`.
- [ ] **Rate limit.** `publish`, `schedule`, `revise` and `retract` share a per-staff-user token bucket like `InjectFireRateLimiterPolicy`; reads and draft edits are unlimited; over-limit is a 429 ProblemDetails with `Retry-After` (NFR-009).
- [ ] **Telemetry.** Staff writes emit via the funnel (story 04); the console emits nothing for these actions (no double count).
- [ ] **Cannot merge unwired.** A `WebApplicationFactory<Program>` test proves every route is mapped (anonymous gets the gate's answer, not 404) and that the real funnel is what the endpoints resolve.

## Out of Scope
The console UI (17); inject attachment (16); participant composer / PRS-021 approval (E5); bulk operations; templates (NWS-021 is E4's).

## Technical Notes
Files: `Features/Channels/Content/Staff/**` (endpoints, request validators, staff mapper). Same empty-prefix group pattern as `InjectEndpoints`. Writes are blind to `exerciseId` (scope from session).

## Dependencies
04 (funnel); 03 for outlet existence. Can run with 05, 06, 11, 12.
