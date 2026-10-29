# Story: Paired social auto-post with link card

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared) with E2  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-004, NWS-015, NWS-031 (discussion link), PRS-013, WX-011, WX-020, SOC-004, XC-004  ·  **Design decisions:** D4-004, D4-011, D3-P1 (slot 9)  ·  **Issue:** #714
**Stack:** backend  ·  **World:** participant output / staff option  ·  **Wave:** 4  ·  **Effort:** M

## Context
A story breaks as a post linking to the article; a release is optionally socialized; a warning posts from @WeatherDesk. All three are "the outlet's paired persona posts a link card",
so it is one seam (`IPairedSocialPoster`), called by the funnel when `PublishOptions.pairedPost` is set.

## Acceptance Criteria
- [ ] **Posts as the outlet.** Given an outlet with a `PairedPersonaId`, when a publish requests a paired post, then a post is created through `PostIngestService.IngestAsync` authored by that persona with the text and the content permalink, `origin` mirroring the content item's (`inject`, `controller`, `participant`), the acting human recorded (COR-018) **from the `ActingHumanId` on the publish call, never from the persona's owner** (so a participant cross-posting a release from a child org outlet, whose `PairedPersonaId` is the org persona, attributes to the human who pressed publish, press FU-8), and scenario time from the exercise clock.
- [ ] **Default text.** Given no text, then the post text defaults to the content headline **verbatim** (D4-011; weather uses the product headline), and a supplied text is sanitized and ≤ 280 code points (the funnel's own rule).
- [ ] **Link card.** Given the new post contains an in-sim permalink, then it renders a link card via the resolver (story 06) — the server contract is satisfied here (`linkPreview` resolution) and the social client consumes it per posts/04.
- [ ] **Discussion link (NWS-031).** The created post id is stored as `ContentItem.PairedPostId` and returned in `ChannelContentDto.pairedPostId`, so "Join the discussion on Pulse" deep links to it; no comment model exists.
- [ ] **Failure never blocks publish.** Given no paired persona, an unresolvable persona, or a funnel refusal, then the content still publishes and the publish result reports `pairedPost: { status: 'skipped'|'failed', reason }`; nothing is retried silently.
- [ ] **No double post.** Given a retried or concurrently repeated publish, then at most one paired post exists per content item (claimed via `PairedPostId` + `Version`).
- [ ] **Share-out telemetry.** The social post's own `post` event carries `origin` and a `payload.sharedContentId`; one `content_share` event (FC-6) is emitted for the share; the participant-facing share button (E4 NWS-030) uses the same path through the normal post composer.
- [ ] **Participant-safe.** The broadcast of the post is the existing participant-safe projection; nothing marks it as auto-generated or controller-originated (XC-002, SOC-002).
- [ ] **Isolation.** The persona and the content must belong to the same exercise; a mismatch is rejected as an unknown id.

## Out of Scope
Composer checkbox UX (E5 D4-004 participant composer; story 17 for staff); posting to other social channels (PDF-04); alert raising (10); editing the post after publish (the existing post-edit story).

## Technical Notes
Files: `Features/Channels/Social/**` (`PairedSocialPoster`, result type). Mirror `FunnelInjectPostPublisher`: a thin in-process call to `PostIngestService`; keep an interface seam for failure-path tests.

## Dependencies
04 (funnel calls it), 06 (resolver). Can run with 15, 16, 17, 19.
