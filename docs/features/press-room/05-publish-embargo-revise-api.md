# Story: Publish, embargo, revise and cross-post API

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-003, PRS-005, PRS-013, PRS-022 (publish event), PRS-020 (the single-gate server half)  ·  **Design decisions:** D4-002, D4-003, D4-004  ·  **Issue:** —
**Stack:** backend  ·  **World:** participant write path  ·  **Wave:** 4  ·  **Effort:** L

## Context
The verbs that make a release visible: publish now, embargo/schedule, cancel the embargo, revise after publish, and the optional social cross-post. All go through `IContentPublishService`
(FC-7); embargo release at the scheduled scenario time is foundation F05. The approval gate is consulted through `IReleaseApprovalGate` (story 01 seam; real impl story 06).

## Acceptance Criteria
- [ ] **Publish now.** Given a draft and a human allowed to release as its org, when `POST …/publish` is called with `confirmed: true`, then the gate is consulted; on `Pass` the item publishes through the funnel (scenario time from `IExerciseClock`, `ContentPublished` push, observers), the response carries the permalink, and exactly one `press_release` event (never also `content_published`) is emitted with the PC-5 payload.
- [ ] **Confirmation is a server contract (D4-002).** Given a publish or schedule call without `confirmed: true`, then it is a 400 with a readable reason and nothing changes; there is no endpoint that publishes as a side effect of a document upload or a draft save.
- [ ] **Embargo (PRS-003).** Given `POST …/schedule { scenarioTime }`, then the time must be ≥ the current scenario time, the item becomes `scheduled` via the funnel, one `press_embargo_set` is emitted, participant reads never include it (F06) **and no list — the wire, a newsroom, the portal Press module — ever lists it** (R-P1), while the author-org and staff DTOs show it with the scheduled scenario time, and F05 publishes it at that time with the **scheduling human** as actor.
- [ ] **Cancel embargo (D4-002, sign-off #2).** Given a scheduled release, when `POST …/unschedule { confirmed }` is called, then it returns to `draft`, a `PressReleaseEvent` audit row ("embargo cancelled by {human} at {scenario time}") is written, approvers (story 06 `IApprovalNotifier`) are notified wire-internally when the gate is enabled for the org, and `press_embargo_cancelled` is emitted with `approversNotified`.
- [ ] **Revise own (PRS-005, Q6).** Given a published release, when an org member calls `POST …/revise { note?, fields }`, then it records a visible `update` revision (scenario time, optional note), prior content is preserved in the revision snapshot, `RevisionCount` increments, `ContentRevised` is pushed and one `content_revised` event is emitted; `correction` and `silent_rewrite` are **not** reachable by participants (400) — those are staff levers.
- [ ] **Cross-post (PRS-013, D4-004).** Given `crossPost: { text? }` is present, when the release publishes, then `PublishOptions.pairedPost` is passed (default text = headline verbatim, ≤ 280 code points) and the result reports `pairedPost` status; absent means **no post** (server default is off); a scheduled release's decision is passed to `ScheduleAsync(id, time, PublishOptions{ pairedPost })`, persisted in `PublishOptionsJson` and replayed by F05's runner (FC-7a, press FU-3 resolved) — no E5 observer and no double-post (F18's claim); a failed post never blocks the publish.
- [ ] **Cross-post preview.** Given `POST …/crosspost-preview`, then it returns the exact link-card data (title, description, image, source name, handle) the post would use, built by the same projector as F06's link resolver, even for an unpublished release, and only for org members.
- [ ] **State machine and concurrency.** Illegal transitions (publish a published release, schedule a retracted one) are 409 with current state; a stale `version` is 409; two simultaneous publishes yield exactly one `ContentPublished`.
- [ ] **No retract (Q6) and no leaks (XC-002).** No participant route retracts; responses never include staff fields; telemetry actors carry the human behind the org handle (COR-018).
- [ ] **Isolation (XC-001).** All routes are behind `RequireChannelEnabled('press')` and exercise-scoped; wrong-exercise ids are 404; added to the standing isolation suite.

## Out of Scope
Approval holding/approve/return (06); UI (07–11); the telemetry evaluator projection (12); the retract and restore verbs (foundation F07, staff); media-persona embargo leaks (parked).

## Technical Notes
Files: `Features/Press/Publishing/**`. Rate-limit like `InjectFireRateLimiterPolicy`. There is no cross-post observer: F04 persists `PublishOptions` at schedule time and F05 replays them (`PayloadJson.crossPost` is only the draft-state checkbox the composer reads back). Cross-post AC is fully verifiable only once F18 lands (seam is a no-op until then, reported as `skipped`).

## Dependencies
Stories 01, 04; foundation F04, F05; F18 for the cross-post AC. Can run with 06, 07, F15, F16, F17, F19.

## Tests
Service tests per verb and per illegal transition; clock-jump test with F05; leak test; isolation additions; wiring test.
