# Story: Participant content read API, permalinks and link resolver

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-011, NWS-015, PRS-011, PRS-010/012 (list + org filter), PRT-004 (featured ordering), SOC-004 (resolver), XC-001, XC-002, COR-053  ·  **Design decisions:** D3-P1, D4-008  ·  **Issue:** #702
**Stack:** backend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** M

## Context
The one read path for published channel content: lists for outlet homepages, the wire and the portal modules; the permalink read; and the in-sim link-card resolver the social
channel's link previews (posts/04) call. The participant projector is the **only** way to build a `ChannelContentDto` (the `ParticipantPostProjector` rule).

## Acceptance Criteria
- [ ] **List.** Given published items, when a participant calls `GET /api/channels/{channelId}/content?outlet=&category=&limit=&cursor=`, then it returns `ChannelContentListDto` newest-first by `publishedScenarioTime` with an opaque cursor, `limit` capped (default 20, max 50); `outlet` filters by slug (an org newsroom or the whole wire).
- [ ] **Featured ordering (PRT-004).** Given `featured=true`, then featured items come first by `featuredRank`, then the rest by recency (the automatic fallback), in one query.
- [ ] **Permalink.** Given `GET …/content/{outletSlug}/{contentSlug}`, then a published item returns `ChannelContentDto` with sanitized `bodyHtml`, media with signed URLs, visible revision markers only, and the kind's projected `payload`.
- [ ] **Retracted tombstone.** Given a retracted item, then the permalink returns the tombstone shape (no headline/body) so the channel renders an in-fiction "no longer available" in the outlet skin (XC-010; Q1 default).
- [ ] **Draft, scheduled, soft-deleted, disabled-outlet and cross-exercise items are one 404.** A response for each is byte-identical to an unknown slug (XC-001/COR-001); a test enumerates all five against the real host.
- [ ] **No leakage (XC-002).** Responses never include origin, acting human, wall clock, status, background tag, featured rank, version, inject id, external ref, or silent-rewrite history; a silently rewritten item shows only its current content and the moved `updatedScenarioTime` (the Updated stamp, FC-1) with no `revisions[]` entry for it.
- [ ] **Channel gate.** Every route is behind `RequireChannelEnabled(channel)`; a disabled channel is a 404 (story 08).
- [ ] **Link resolver.** Given `GET /api/link-previews?path=/news/newsline-7/emergency-call-delays`, then it returns `{ title, description?, image?, sourceName, permalink }` for a published, in-scope item and 404 for anything else (external URLs, other exercises, drafts, non-content paths); it performs **no** outbound fetch (SOC-004).
- [ ] **Scenario time + host-relative.** Every instant is a `scenarioTime` ISO string and every URL field is host-relative (FC-9.2/9.3).
- [ ] **Telemetry is not emitted here** (views are client-reported via story 15 so a list scan is not a read); nothing is written on GET.

## Out of Scope
Search across channels (E2 search owns `SOC-0xx`); per-viewer state; the realtime push (09); view/dwell capture (15); the portal's aggregation endpoints (E3 may compose these); comments (NWS-031 — never).

## Technical Notes
Files: `Features/Channels/Content/Read/**` (read service, projector, endpoints, `InSimLinkResolver`). Keyset pagination on `(PublishedScenarioTime desc, Id)`. Index support comes from story 01. The kind descriptor's `ProjectPayload` supplies `payload`. Lists contain **published** items only, so a scheduled/embargoed release can never appear in any list (portal R-P1, restated for the press wire and the portal module). An embargoed item's **author** gets no special case here: press reads its own author endpoint, so this route's 404 for draft/scheduled must stay uniform (press FU-6).

## Dependencies
01, 02, 04 (projector shares the kind registry), 08 (gate). Can run with 05, 07, 11, 12.
