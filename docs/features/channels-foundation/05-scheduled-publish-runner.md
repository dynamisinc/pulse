# Story: Scheduler — embargo, scheduled publish, time jumps

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** NWS-013, PRS-003, WX-002 (seam: snap on jump, freeze on suspend), COR-050/051, XC-004  ·  **Design decisions:** D4-003  ·  **Issue:** #701
**Stack:** backend  ·  **World:** staff/data  ·  **Wave:** 3  ·  **Effort:** M

## Context
Scheduled articles and embargoed releases must go live at a **scenario time**, survive restarts and honour the pause tiers, like `InjectBurstRunner`. The runner is a thin hosted
service over `IContentPublishService.PublishAsync`; it adds no lifecycle logic of its own.

## Acceptance Criteria
- [x] **Publishes when due.** Given a `scheduled` item whose `ScheduledScenarioTime` ≤ the exercise's scenario time, when the runner ticks, then it publishes through the funnel (`ContentPublished` push, telemetry, observers) with `actor` = the human who scheduled it and `origin` unchanged, calling `PublishAsync(id)` **without options** so the funnel replays the persisted `PublishOptionsJson` or the kind's `ResolvePublishOptions` (FC-7a): the alert and paired post chosen at schedule time (or a weather payload's `delivery` block) fire at publish, and a retried tick never duplicates them.
- [x] **Invisible until then (PRS-003).** Given a scheduled item, then participant reads (story 06) and the stream never include it; the author/staff DTOs show it with its scheduled scenario time.
- [x] **Exactly once.** Given two app instances or a restart mid-tick, when both see the same due item, then exactly one publish happens (claim via the `Version` token); the loser skips silently.
- [x] **Pause tiers.** Given **Freeze world**, then nothing publishes and the item stays `scheduled`; **Pause injects** and **Pause engine** do not block scheduled content (it is authored world content, not an inject) — confirmed against `PauseTierRegistry` semantics and pinned by a test.
- [x] **Time jumps (COR-051).** Given a forward scenario-time jump past several scheduled items, when the clock changes, then every due item publishes in `ScheduledScenarioTime` order with its **own scheduled time as `PublishedScenarioTime`** (not the jump target), so the timeline stays honest; a backward jump never un-publishes anything.
- [x] **Failure is visible.** Given a publish that the funnel refuses (e.g. a retracted outlet, invalid payload), then the item returns to `draft` with a staff-visible `LastError` (FC-2) and the runner does not retry-loop; one `content_schedule_failed` event is emitted.
- [x] **Background scope.** The runner creates a scope per exercise and sets `ExerciseContext.CurrentExerciseId` **before** resolving `PulseDbContext`, discovers due ids with an `IgnoreQueryFilters()` id-only read, and is a registered hosted service (wiring test on the real `Program`).
- [x] **No DB work while the host starts**, failing sweeps back off, and a repeated failure logs once (the `InjectBurstRunnerLoopTests` guarantees).

## Build notes
Built in `Features/Channels/Content/Scheduling/**` (`ContentScheduleRunner`, `ScheduledByReader`, `ContentScheduleSignal`
+ `ContentScheduleClockObserver`), registered by `AddContentScheduling()` from `AddChannels()`. Tests:
`ContentScheduleRunnerTests` (each AC), `ContentScheduleRunnerLoopTests` (start-up, backoff, log once),
`ContentScheduleRunnerSqlTests` (exactly once on real SQL) and the composition-root wiring test.

Decisions where the AC was silent:
- **The claim.** The runner publishes through the funnel's `IScheduledContentPublisher.PublishDueAsync` (= `PublishAsync`
  with no options, FC-7a) only while the item is still `scheduled`, still due and at the `Version` it discovered, so a
  staff unschedule / edit / reschedule that lands mid-tick wins (`Conflict`, skipped).
- **Who it acts as.** "The human who scheduled it" is read from the item's latest `content_scheduled` (`action: schedule`)
  event (no column holds it, no migration in this wave); fallback is the item's own attribution.
- **Publish stamp.** The item's own scheduled time (COR-051), but never earlier than the schedule call (a schedule set for
  a time already past never back-dates) and never later than now. A staff publish-now always stamps now.
- **Lifecycle.** Only a `live` exercise (`ScenarioContentFires`) publishes; an exercise with unknown scenario time
  publishes nothing.
- **Refusal.** The funnel's publish now re-checks the outlet and the stored payload for every publish (fail closed).
  `Invalid` or `Held` → draft + `lastError` (on the staff DTO, staff-only; it keeps the due time) + one
  `content_schedule_failed`.

## Out of Scope
Cancelling an embargo's notification fan-out to approvers (PRS-021, E5); the weather timeline engine (WX-002 — E6 builds it on this runner or its own, using the same clock-jump rule); recurring/periodic publishes.

## Technical Notes
Files: `Features/Channels/Content/Scheduling/**`. Model on `InjectBurstRunner` + `EnginePublishService.cs:83-129` (scope + context ordering). `Program.cs` hosted-service registration is orchestrator-owned.

## Dependencies
04 (funnel). Can run with 06, 07, 11, 12.
