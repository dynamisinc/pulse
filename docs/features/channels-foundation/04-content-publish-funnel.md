# Story: Content publish funnel and lifecycle

**Feature:** Channels foundation  ·  **Epic:** E4 (with E5/E6)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** NWS-013, NWS-022, PRS-005, PRS-004, PRS-022, WX-010, WX-011, XC-004, XC-010, COR-053, NFR-004  ·  **Design decisions:** D3-P4, D4-002  ·  **Issue:** #700
**Stack:** backend  ·  **World:** staff/data  ·  **Wave:** 2  ·  **Effort:** L

## Context
The one funnel (`IContentPublishService`, FC-7) every publisher calls, the way every post goes through `PostIngestService`: staff API, inject fire, the scheduler, a participant
release composer, the engine. It owns sanitization, scenario-time stamping, the status machine, revisions, telemetry, broadcast and observers, so no channel re-implements them.

## Acceptance Criteria
- [x] **Status machine (FC-1).** Given an item, when a transition outside the frozen table is requested, then it is a 409 carrying the item's current state; allowed transitions succeed. Each state change bumps `Version`; a stale version is a 409 and two simultaneous publishes yield exactly one `ContentPublished` (claimed through the concurrency token).
- [x] **Server-stamped scenario time (COR-053).** Given publish, then `PublishedScenarioTime` = `IExerciseClock.CurrentScenarioTime(exerciseId) ?? exercise.CurrentScenarioTime ?? now`, never a client value, and `PublishedWallClock` is stored for staff/telemetry only. A scheduled item keeps `ScheduledScenarioTime` until the runner publishes it.
- [x] **Sanitization and validation (NFR-004).** Given `bodyHtml` with `<script>`, event handlers, `javascript:` URLs or style-borne payloads, when saved, then the stored `BodyHtml` is sanitized once at write by the kind's **named** profile from `ISanitizerProfileRegistry` (built-ins `plain`, `rich-basic`, `rich-tables`; a descriptor may register an additional profile at DI time, e.g. news `article-rich`; an unknown profile is a startup failure, news FU-8 / press FU-5); media ids must belong to the exercise and pass the existing media rules; an invalid payload (`ValidatePayloadAsync` with an exercise-scoped context, weather FU-3) is a readable 400.
- [x] **Revisions and the Updated stamp.** Given `revise` with kind `update` or `correction`, then the prior fields are snapshotted as a `ContentItemRevision`, the visible marker (`Visible=true`, scenario time, note) is added, and `RevisionCount` increments; kind `silent_rewrite` snapshots and swaps the content with **no note and no `revisions[]` entry** (NWS-013's quiet lever, D3-P4); all three set `UpdatedScenarioTime` (the "Updated" stamp) unless `ReviseOptions.touchUpdatedStamp = false` (default `true`; a payload-only change such as setting or clearing a breaking banner moves nothing participant-visible, news FU-1/FU-2); pre-publish draft edits are `edit` revisions retaining the edit timeline (PRS-004) and never move the stamp.
- [x] **Soft delete and retract.** Given a published item, when it is retracted, then status is `retracted`, `RetractedScenarioTime` is stamped and the item stays in the database; soft delete sets `DeletedAt` and never removes revisions (XC-010).
- [x] **Callers and the publish gate.** Given a caller with `origin: participant` (the E5 composer) or `controller`/`inject`/`engine`, then the funnel accepts it, takes `origin` and `ActingHumanId` only from the caller's authenticated context (never a request body) and leaves authorization to the calling endpoint; an `IContentPublishGate` (default pass-through) is consulted before publish/schedule and `Hold(reason)` is a 409 `held` with state unchanged, while `Allow(auditNote)` records `payload.gateNote` on the `content_published` event (press FU-2).
- [x] **Engine drafts.** Given `origin: engine`, when created, then the item is always `draft` and can only be published by a staff-attributed call (NWS-022).
- [x] **Telemetry (XC-004).** Each publish/schedule/revise/retract/restore/delete emits exactly one server-side event per FC-6 (`content_published`, or `press_release` for a participant `release`, never both) in the same unit of work, carrying wall + scenario time, `actor.actingHumanId` (the human behind a shared org account), `origin` and `injectId`.
- [x] **Broadcast and observers.** After commit, `IFeedBroadcaster` is called with the participant-safe projection (`ContentPublished` / `ContentRevised` / `ContentRetracted`) and every registered `IContentPublishedObserver` is notified; a failing observer or broadcaster never rolls back or fails the publish.
- [x] **Optional side effects are seams.** `PublishOptions.alert` calls `IAlertRaiser` and `PublishOptions.pairedPost` calls `IPairedSocialPoster` when registered; when either is absent or fails, the publish still succeeds and the result reports the side effect's outcome.
- [x] **Options resolution and persistence (FC-7a; press FU-3, weather FU-2).** Given `ScheduleAsync(id, time, options?)`, then the options are stored in `PublishOptionsJson`; given a publish with no options on the call (the scheduler, an inject fire, a staff publish from a kind whose editor owns delivery), then the funnel uses the **first non-null** of persisted options, then the kind's `ResolvePublishOptions(item)`, then none, and a kind's `DefaultAlertMapping` is **never** applied automatically (it only pre-fills the staff dialog); a scheduled weather warning therefore still raises its alert and `@WeatherDesk` post at its scheduled scenario time.
- [x] **Isolation and lifecycle.** All reads/writes go through `PulseDbContext`'s scoped filter and write guard; publishing into an exercise that is not participant-accessible follows the same rule as post ingest (no live push to participants after EndEx; tracked by #640 for producers).

## Out of Scope
Endpoints (07), the scheduler (05), the paired post (18), the alert source (10), participant read projection (06), E8 reaction logic (observers only), approval gates (PRS-021).

## Technical Notes
Files: `Features/Channels/Content/Publish/**` (service, transition table, `ContentSanitizer` / `ISanitizerProfileRegistry` delegating to `PostSanitizer`, options resolver, gate hook, revision writer, telemetry). This is the longest-pole foundation story (12 ACs, effort L): if build capacity forces a split, cut after the "Revisions" AC — core lifecycle + sanitization first, then the options/gate/profile extensions as a second PR against the same folder. Mirror `PostIngestService`
shape and the `InjectQueueService` concurrency/claim approach. Kind descriptors are resolved from DI by `Kind`; an unregistered kind is a 400 (so E4/E5/E6 each register theirs).

## Dependencies
01, 02. Calls into 03's `Outlet` rows (reads entity directly). Blocks 05, 06 (projector reuse), 07, 16, 18.

## Build notes (#700)
Built in `Features/Channels/Content/Publish/**`; AC-named tests in `Pulse.WebApi.Tests/Features/Channels/Publish/**`
(`ContentPublishServiceTests`, `ContentPublishIsolationTests`, `ContentSanitizerTests`, `ContentTransitionsTests`, and the
Docker-only `ContentPublishSqlTests` race). Decisions where the contracts were silent:
- **Telemetry.** Schedule/unschedule emit `content_scheduled` (FC-6 names none; fold into FC-6b). Restore is
  `content_published` with `payload.action: restore`, and soft delete is `content_retracted` with `payload.action: delete`.
  Envelope `origin` is mapped onto the v0 union: `participant`, `engine` and `inject` are passed through; `controller` is
  omitted (the actor is `system` with `actingHumanId`). Several gate notes are joined with `; ` into one `gateNote`.
- **FC-7a.** `ScheduleAsync(.., null)` keeps the persisted options (inject attach), and an explicit empty `PublishOptions`
  means none. A participant caller's call options are ignored and never persisted (the alert and the persona post are
  staff levers).
- **Callers.** The engine edits only its own drafts. A participant cannot set `background`, `featuredRank` or
  `externalSource`/`externalRef`. A staff edit that omits both external fields keeps them. A hero image or video must
  also appear in `media[]` with alt text.
- **Timestamps.** Restore keeps `RetractedScenarioTime` (it is the *last* retraction, FC-2), so readers key off `Status`.
  Publish keeps `ScheduledScenarioTime`. A soft-deleted scheduled item keeps `Status = scheduled`, and the runner (05)
  must filter `DeletedAt`.
- **Requirements for later stories.**
  - Story 07 / press must enforce ownership and authorization: a participant may act only on their own items.
  - The result is always the staff DTO, which the endpoint re-projects for participants (XC-002).
  - The kind descriptor has no per-kind body length cap (weather narrative 4,000): additive follow-on.
