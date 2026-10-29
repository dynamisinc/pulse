# Story: Inject-queue integration — content injects

**Feature:** Channels foundation  ·  **Epic:** E7 (inject queue) with E4/E5/E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-013 (held for controller fire), WX-012 (warnings firable as injects), CTL-010, CTL-011, XC-004, XC-010  ·  **Design decisions:** IQ-1…IQ-10 (inject-queue implementation.md)  ·  **Issue:** —
**Stack:** backend  ·  **World:** staff  ·  **Wave:** 4  ·  **Effort:** M

## Context
Social inject posts fire through `PostIngestService`. A prepared article, release or warning is the same idea: an inject item that, when fired, publishes a **pre-authored draft
`ContentItem`** through the funnel. The queue's state machine, exactly-once claim, pause tiers and telemetry stay as they are; only the child changes. Cadence-pushed content (PDF-06)
lands here later via `ExternalSource/ExternalRef`.

## Acceptance Criteria
- [ ] **New kind.** Given the inject vocabulary, then `InjectItem.Kind` accepts `content` besides `post|burst`, with one child referencing a `ContentItem` (`ContentItemId`) in the same exercise; a content id from another exercise, or one that is not `draft`/`scheduled`, is rejected like an unknown id (COR-001). One migration (**M4** in the [ledger](implementation.md#migration-ledger), after M1–M3) adds the column.
- [ ] **Fire publishes through the funnel.** Given a `content` item, when a controller fires it, then `IContentPublishService.PublishAsync` runs with `origin: inject`, `injectId` = the item id, the pressing controller as acting human, scenario time from the exercise clock; the item's persisted `PublishOptionsJson` (set when the content was attached/scheduled) or the kind's `ResolvePublishOptions` is applied through the funnel's FC-7a resolution (no dialog, no options on the call); the item moves to `fired` and records the published scenario time.
- [ ] **Same machine.** Hold / release / skip / unskip / retry, version conflicts (409), exactly-once under concurrent fire, `Freeze` blocks fire (409 "The world is frozen"), `Pause injects` still allows manual fire — identical to `post` items (the inject-queue tests are parametrized over the new kind).
- [ ] **No double publishing.** Given the content item is also `scheduled`, when it is fired manually, then it publishes once and the scheduler does not publish it again; editing a draft attached to a pending inject is allowed, editing after `fired` is not.
- [ ] **Failure is visible.** If the funnel refuses (invalid payload, retracted outlet), then the item becomes `failed` with the message and nothing is marked fired.
- [ ] **Telemetry.** Fire emits the queue's `inject_action` event **and** the funnel's `content_published` event carrying `injectId`; the console emits nothing (no double count).
- [ ] **Read model.** `GET /api/injects` returns content items with `{ kind: 'content', contentItemId, contentKind, headline, outletName, channelId }` (staff DTO only, XC-002) so the console can render them.
- [ ] **Staff only, wired.** Routes stay behind the existing staff gate; a composition-root test on the real `Program` fires a content inject end to end through the real funnel and asserts the persisted item, telemetry, the `ContentPublished` push and observer notification.

## Out of Scope
Bursts of content (a burst is posts only); MSEL/run-sheet import of content rows (a follow-up on the import story once E4/E5/E6 define their columns); the console UI rendering (17); Cadence push endpoint (E9).

## Technical Notes
Files: `Features/Injects/**` (additive: vocabulary, validator, `InjectQueueService` fire branch, DTO), `Data/Entities/InjectItem.cs`, migration **M4** (the foundation's second and last; channel migrations M2/M3/M5 are in the ledger). Reuse `IInjectPostPublisher`'s seam idea: add `IInjectContentPublisher` (production = the funnel) so the failure path is testable.

## Dependencies
04 (funnel), 07 (draft authoring and attach). Can run with 15, 17, 18, 19.
