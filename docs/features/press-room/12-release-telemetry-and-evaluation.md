# Story: Release telemetry, evaluator signals and the reaction hook

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-022, PRS-004 (NFR-007 disclosure), EVL-010 (approval-gate and release latency inputs), XC-004  ·  **Design decisions:** D4-002, D4-007  ·  **Issue:** #748
**Stack:** backend  ·  **World:** staff/data (+ one participant-facing disclosure string)  ·  **Wave:** 5  ·  **Effort:** M

## Context
The Press Room is a major evaluation source: *what did the PIO publish, when, was it accurate, did it address concerns?* (epic §1). Event emission lives with each action story (01 defines, 04/05/06 emit);
this story completes the loop: the world-reaction event (PRS-022) for E8, an evaluator-facing read model of the signals E10 needs, a completeness guard so no signal silently goes missing, and the NFR-007 capture disclosure.

## Acceptance Criteria
- [ ] **Reaction hook (PRS-022).** Given a release publishes (now, scheduled, approved), then `PressReleaseObserver` (an `IContentPublishedObserver`, F04) raises `ReleasePublishedEvent { contentId, orgPersonaId, scenarioTime, headline, documentPresent, crossPosted }` to every `IReleaseReactionHook`; E8/E10 consumers attach there; a failing hook never fails the publish; a no-op default exists so E8 is not a prerequisite.
- [ ] **Evaluator read model.** Given `GET /api/press/evaluation/releases` (staff evaluator/controller roles), then each release returns: first draft scenario time, first attachment time (when one exists), publish time, the draft→publish duration (and attach→publish when an attachment exists), revision count with each `edit`/`update` timestamp and acting human, input path (`rich` / `attachment` / `both`), embargo set/cancel events, approval requested/decided/returned with latencies, cross-post decision, and per-human attribution behind the org handle; wall and scenario time both present (staff DTO only).
- [ ] **Edit timeline (PRS-004).** Given a release's `ContentItemRevision` `edit` rows, then the read model exposes a timeline with a "what changed" summary between drafts (text-length delta and changed fields; full snapshot diff on demand), sufficient to show "the hedge was added in revision 3".
- [ ] **Latency joins (EVL-010).** Given a release linked to a storyline/inject with an expected response (E10's join), then the model exposes the keys E10 needs (release id, org, scenario publish time, approval latency separately); E5 computes no EVL metric itself.
- [ ] **Completeness guard.** Given the PC-5 vocabulary, then a test fails when an E5 action (create draft, set/cancel embargo, publish, revise, request/approve/return) completes without its declared event, or emits a type not declared, or emits `content_published` for a participant release (FC-6: `press_release` only).
- [ ] **Actor shape (XC-004, COR-018).** Every E5 event carries wall + scenario time, `actor.actingHumanId` (the human behind the shared org account), `actor.orgPersonaId`, `channel: 'press'`; none carries absolute URLs (FC-9.3).
- [ ] **Capture disclosure (NFR-007).** Given the composer, then `GET /api/press/disclosure` (or the org DTO) serves the standing disclosure text ("Your drafting activity, including drafts and edit timing, is recorded for the exercise evaluation") for story 07's header; it is exercise-configurable text with a default.
- [ ] **Session-level labelling.** Reader-side view metrics for releases are labelled session-level, not person-level, in the read model (NWS-030/EVL-012 convention).
- [ ] **Isolation and role (XC-001).** The route is staff-only and exercise-scoped; participants get 403/404; cross-exercise ids 404.

## Out of Scope
E8 reaction logic, E10 dashboards/metrics/AAR export (EVL-010..015, EVL-030), client view telemetry (F15), approval UI (10).

## Technical Notes
Files: `Features/Press/Evaluation/**`. Reads `ContentItemRevision`, `PressReleaseEvent` (06), telemetry store. Observer registered in `AddPress()` (orchestrator). Wiring test on real `Program`.

## Dependencies
Stories 04, 05, 06; foundation F04. Can run with 08, 09, 10, 11, 13, 14.

## Tests
Observer test with a throwing hook; completeness test; read-model tests over a seeded draft→approve→publish→revise timeline; authz and isolation tests.
