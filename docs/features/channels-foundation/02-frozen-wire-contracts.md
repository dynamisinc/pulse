# Story: Frozen wire contracts, client types and mock fixtures

**Feature:** Channels foundation  ·  **Epic:** E3–E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-010, NWS-011, PRT-011, XC-002, XC-004, COR-053  ·  **Design decisions:** D3-P2, D4-010  ·  **Issue:** #698
**Stack:** fullstack  ·  **World:** both (types only)  ·  **Wave:** 1  ·  **Effort:** M

## Context
Contract-first, like demo-feedback 01/17. The E4/E5/E6/E3 decomposers and the Wave-2+ builders import the **names** frozen in `implementation.md` (FC-1, FC-3, FC-5, FC-7,
FC-8). This story turns that document into code on both sides so a drift is a compile or guard failure, not a review comment.

## Acceptance Criteria
- [ ] **DTOs mirror FC-3 field for field.** Given `OutletRefDto`, `OutletDto`, `ContentMediaDto`, `ChannelContentSummaryDto`, `ChannelContentDto`, `ChannelContentListDto`, `ChannelContentStaffDto`, `ContentWriteRequest`, `AlertDto`, when serialized, then the camelCase wire keys equal the frozen shapes; a snapshot test pins each.
- [ ] **Participant DTOs cannot leak (XC-002).** Given the participant DTO types, when reflected over in a test, then none exposes `origin`, `actingHumanId`, wall-clock, `status`, `background`, `featuredRank`, `version`, `injectId` or `externalRef`; the retracted shape carries no body.
- [ ] **TS types and runtime guards.** Given each wire type, when a response is out of shape (missing id, unknown severity, non-ISO `scenarioTime`), then the guard rejects it so a live endpoint fails closed; extra keys are tolerated (additive evolution), mirroring `isAlert`.
- [ ] **Vocabulary on both sides.** `ChannelVocabulary` (C#) and `vocabulary.ts` define the FC-1 values; a test asserts the two lists are identical, and that the channel ids equal `ChannelCatalog` ids.
- [ ] **Seams declared.** The FC-7 interfaces (`IContentPublishService` with `ReviseOptions{ touchUpdatedStamp }` and options-carrying `ScheduleAsync`, `IContentKindDescriptor` with **async** `ValidatePayloadAsync(json, PayloadValidationContext)` and `ResolvePublishOptions`, `ISanitizerProfileRegistry`, `IContentPublishGate`, `IContentPublishedObserver`, `IAlertRaiser`, `IPairedSocialPoster`, `IInSimLinkResolver`, `IContentPermalinks`, `ISkinOverridesValidator`) exist with XML docs and no sync-only payload validation is offered (weather FU-3); `IFeedBroadcaster` gains the four FC-5 methods as **no-op default interface methods** so existing test doubles still compile.
- [ ] **Permalinks are path-only.** `IContentPermalinks.For` and `contentPermalink()` return `/{channelId}/{outletSlug}/{contentSlug}` and never a host (FC-9.3); a test rejects any value containing `://` or a leading `//`.
- [ ] **Telemetry vocabulary, once for every channel (FC-6b).** Given the FC-6b list (foundation, news `content_video_play`/`content_video_progress`/`content_embed_open`, press `press_*`, weather `weather_zone_changed`, portal `portal_*`/`resource_view`/`display_*`), then `KNOWN_TELEMETRY_EVENT_TYPES` and the server vocabulary constants gain exactly those additive entries in this one edit, the v0 envelope schema test passes unchanged, and no channel story edits either list.
- [ ] **Mock fixtures.** `features/channels/mocks/` supplies fixtures for one outlet per content channel, a published, a retracted and a revised item, and two alerts, served behind the shared axios client with a single env-guarded flip point (the `brandTokens.ts` pattern), so Wave-2+ frontend stories run without the backend.

> **Build note (F02, #794; orchestrator option B):** the four FC-7 members typed on F01's `ContentItem` entity
> (`IContentKindDescriptor.ResolvePublishOptions`, `IContentPublishGate`, `IContentPublishedObserver`,
> `IPairedSocialPoster`) landed in their own commit on the same PR after F01 (#697, PR #796) merged.

## Out of Scope
Implementations of any seam; endpoints; the broadcaster implementation (story 09); skin token values (story 13 / E4); kind-specific payload shapes (each channel's descriptor).

## Technical Notes
Files: `src/Pulse.WebApi/Features/Channels/Contracts/**`, `Features/Realtime/IFeedBroadcaster.cs` (additive defaults only), `src/frontend/src/features/channels/contract/**`, `.../mocks/**`, `src/frontend/src/core/telemetry/schema.ts` (vocabulary additions only) and the server vocabulary constants.
Follow the `ParticipantShellDtos.cs` convention (string-typed wire literals, no C# enums on the wire). The `OutletSkinTokens` TS type lives with story 13, but the `skinKey` / `skinOverrides` fields on `OutletDto` are frozen here.

## Dependencies
None. Blocks everything in Waves 2–5; can run with 01.
