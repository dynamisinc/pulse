# Story: Post v2 read and write

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** SOC-001, SOC-002, SOC-011, SOC-054, COR-024, XC-002, XC-001  ·  **Design decisions:** DP-5, DP-6, DP-8 (implementation.md §0)  ·  **Issue:** #425
**Story ID:** BP  ·  **Stack:** backend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 1b
**Home story:** [`posts/01`](../posts/01-post-composition.md), [`amplification/02`](../amplification/02-amplification-counts.md) (counts).

## Context
**As** a participant or controller, **I want** posts to carry photos/video, reply links and real counts, **so
that** the feed, profiles and the SignalR push show a finished product. Today `POST /api/posts` accepts media
but **does not store it** (`PostWriteEndpoints.cs:206-209`), counts are hard-coded `0,0,0`
(`ParticipantPostDto.cs:68`), `GET /api/feed` has no `Take`, and personas have no images. This story is the
single editor of the ingest funnel and the read projection. Wire shapes: implementation.md §1.5.2–§1.5.3,
§1.5.6.

## Acceptance Criteria
- [ ] **Media on write.** Given `media[]` on `POST /api/posts`, then it accepts ≤ 4 images **or** exactly 1
      video (never mixed), each `mediaId` must resolve **in the caller's exercise** (an unknown and a
      cross-exercise id give the identical 400), a participant may attach only assets whose `UploadedByHumanId`
      equals their own acting human, `alt` is sanitized and required (1..1000), duplicates are rejected, and the
      `PostMediaItem` rows commit in the **same unit of work** as the post and its telemetry event.
- [ ] **Legacy placeholder compatibility (DP-6).** Given the pre-demo frontend's `media: [{kind, alt}]` (no
      `mediaId` on *any* entry), then the entries are ignored (logged) and the post is created as text; a mix of
      entries with and without `mediaId` is a 400.
- [ ] **Baseline is staff-only.** `engagementBaseline {like, repost, reply}` (0..1,000,000) is honoured only for
      a staff `controller-as-persona` write **or an in-process `inject` write** (amended 2026-10-08,
      [`inject-queue` IQ-10](../inject-queue/implementation.md#decisions-iq-n)) and stored on the post. Media,
      reply-parent and baseline handling live **inside `IngestAsync`**, so the inject fire path gets the same
      validation as HTTP; for a participant session it is ignored;
      out-of-range from staff is 400. It never appears on any participant payload.
- [ ] **Reply write via the seam.** A non-empty `parentPostId` is resolved through `IReplyParentResolver`;
      `NotFound` → 400 (same text for unknown/cross-exercise/deleted); `Resolved` → `Post.ParentPostId` set and
      the telemetry event is `reply` with `payload.parentPostId`. With no resolver registered, a non-empty
      `parentPostId` is a 400, not a silent top-level post.
- [ ] **Projection.** `IParticipantPostProjector` yields `counts = baseline + real` (via
      `IPostEngagementReader`), `media` with signed `url`/`posterUrl` (`IMediaUrlSigner`), `inReplyTo {postId,
      authorHandle}`, and `viewer {liked, reposted}` **only** for a persona-bound participant session (omitted
      for staff and for broadcasts). `GET /api/feed` returns top-level, non-deleted posts newest-first by
      scenario time with **`Take(200)`**, `?includeReplies=true` also returns replies (DP-5), and the Following
      scope applies the same rules.
- [ ] **Realtime and responses.** `PostReceived` carries the projector output (no `viewer`) for posts and
      replies; the 201 body is the participant shape or `StaffPostDto` (which gains `media`, `inReplyTo`); the
      existing five-argument `PostIngestService` constructor still compiles (new collaborators are trailing
      optional parameters; absent ⇒ today's behaviour).
- [ ] **Personas.** `PersonaResponseDto` and `StaffPersonaResponseDto` gain `avatarUrl?`, `bannerUrl?`,
      `location?` (signed via the signer; omitted when null); `GET /api/personas` for a participant still has
      **no** `personaType`/`castable` (SOC-052/D1-008 regression stays green);
      `PersonaReadService.GetStaffPersonaAsync(Guid)` exists for PE-BE.
- [ ] **XC-002 structural check.** A test walks the serialized participant feed/thread/broadcast/persona
      payloads and fails if any of `origin`, `actingHumanId`, `createdWallClock`, `injectId`,
      `uploadedByHumanId`, `blobName`, `contentType`, `bytes`, `originalFileName`, a baseline field,
      `personaType` or `castable` appears.

## Out of Scope
The thread read and reply-parent resolver (B2); reaction endpoints and the engagement reader (B3); the upload
endpoint (BM); takedown (B6); server-persisted link previews; a baseline UI; performance work beyond `Take(200)`
and one batched media/URL lookup per read.

## Technical Notes
- Files: implementation.md §4.1 row BP. Participant API (no UI). Keep scope server-authoritative:
  `IExerciseContext` only; reuse `PostAttributionResolver`/`PostAttribution`, `PostSanitizer.Sanitize` (alt
  text), the existing `ParticipantPostCounts`. Fill in the B1 skeleton (`ParticipantPostDto` members,
  `PostWireDtos`); do not edit the frozen interfaces.
- Register the projector inside the existing `AddSocialFeedRead`/`AddSocialPostWrite` extensions so `Program.cs`
  needs no new line for BP. Batch: one query for media items + assets, one for engagement, one for reply parents
  — no N+1.
- A reply to a soft-deleted parent is impossible (resolver returns NotFound); a reply whose parent is deleted
  *later* keeps its `inReplyTo`.

## Dependencies
B1 (entities + frozen interfaces). Compiles against `IMediaUrlSigner`, `IPostEngagementReader`,
`IReplyParentResolver` without BM/B3/B2 code; end-to-end behaviour needs them merged (Gate 2). Runs with BM, B2,
B3, B6.

## Tests
- **Isolation (first):** new `Features/Social/PostMediaIsolationTests.cs` — attach exercise A's asset from B →
  400; reply parent from A → 400; feed/projection under scope B never contains A's media/URLs; participant
  cannot attach another participant's upload.
- **Write rules:** counts/limits matrix (4 images, 1 video, mixed, 5 images, 2 videos, missing alt, duplicate
  id), legacy placeholder, baseline staff-vs-participant, single transaction (post + items + event or nothing).
- **Projection:** baseline + real counts, viewer present/absent, `includeReplies`, `Take(200)`, ordering by
  scenario time (COR-053 — never wall-clock), soft-deleted excluded, SAS URL identical across two reads in one
  bucket.
- **XC-002 payload walk** (above) and the unchanged
  `PostWriteEndpointTests`/`FeedReadEndpointTests`/`PersonaEndpointsTests`.
- Telemetry: exactly one `post` (or `reply`) event per create.
