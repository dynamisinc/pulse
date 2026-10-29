# Story: Scheduler — embargo, scheduled publish, time jumps

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-013, PRS-003, WX-002 (seam: snap on jump, freeze on suspend), COR-050/051, XC-004  ·  **Design decisions:** D4-003  ·  **Issue:** #701
**Stack:** backend  ·  **World:** staff/data  ·  **Wave:** 3  ·  **Effort:** M

## Context
Scheduled articles and embargoed releases must go live at a **scenario time**, survive restarts and honour the pause tiers, like `InjectBurstRunner`. The runner is a thin hosted
service over `IContentPublishService.PublishAsync`; it adds no lifecycle logic of its own.

## Acceptance Criteria
- [ ] **Publishes when due.** Given a `scheduled` item whose `ScheduledScenarioTime` ≤ the exercise's scenario time, when the runner ticks, then it publishes through the funnel (`ContentPublished` push, telemetry, observers) with `actor` = the human who scheduled it and `origin` unchanged, calling `PublishAsync(id)` **without options** so the funnel replays the persisted `PublishOptionsJson` or the kind's `ResolvePublishOptions` (FC-7a): the alert and paired post chosen at schedule time (or a weather payload's `delivery` block) fire at publish, and a retried tick never duplicates them.
- [ ] **Invisible until then (PRS-003).** Given a scheduled item, then participant reads (story 06) and the stream never include it; the author/staff DTOs show it with its scheduled scenario time.
- [ ] **Exactly once.** Given two app instances or a restart mid-tick, when both see the same due item, then exactly one publish happens (claim via the `Version` token); the loser skips silently.
- [ ] **Pause tiers.** Given **Freeze world**, then nothing publishes and the item stays `scheduled`; **Pause injects** and **Pause engine** do not block scheduled content (it is authored world content, not an inject) — confirmed against `PauseTierRegistry` semantics and pinned by a test.
- [ ] **Time jumps (COR-051).** Given a forward scenario-time jump past several scheduled items, when the clock changes, then every due item publishes in `ScheduledScenarioTime` order with its **own scheduled time as `PublishedScenarioTime`** (not the jump target), so the timeline stays honest; a backward jump never un-publishes anything.
- [ ] **Failure is visible.** Given a publish that the funnel refuses (e.g. a retracted outlet, invalid payload), then the item returns to `draft` with a staff-visible `LastError` (FC-2) and the runner does not retry-loop; one `content_schedule_failed` event is emitted.
- [ ] **Background scope.** The runner creates a scope per exercise and sets `ExerciseContext.CurrentExerciseId` **before** resolving `PulseDbContext`, discovers due ids with an `IgnoreQueryFilters()` id-only read, and is a registered hosted service (wiring test on the real `Program`).
- [ ] **No DB work while the host starts**, failing sweeps back off, and a repeated failure logs once (the `InjectBurstRunnerLoopTests` guarantees).

## Out of Scope
Cancelling an embargo's notification fan-out to approvers (PRS-021, E5); the weather timeline engine (WX-002 — E6 builds it on this runner or its own, using the same clock-jump rule); recurring/periodic publishes.

## Technical Notes
Files: `Features/Channels/Content/Scheduling/**`. Model on `InjectBurstRunner` + `EnginePublishService.cs:83-129` (scope + context ordering). `Program.cs` hosted-service registration is orchestrator-owned.

## Dependencies
04 (funnel). Can run with 06, 07, 11, 12.
