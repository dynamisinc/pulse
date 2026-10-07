# Story: Client seam — PostCard split, contract v2, mocks, upload client

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-001, SOC-002, XC-002, XC-009, COR-053  ·  **Design decisions:** D1-011 (controls absent, not disabled)  ·  **Issue:** —
**Story ID:** F0  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** L (may run as two sub-tracks in one worktree)  ·  **Wave:** 1
**Home story:** — (client seam for [`posts/01`](../posts/01-post-composition.md) and [`posts/02`](../posts/02-post-rendering-identity.md)).

## Context
**As** a Wave-2/3 frontend builder, **I want** `PostCard` already decomposed, the v2 wire types and mocks in
place, and a shared upload client, **so that** F1–F6 and C1–C5 own disjoint files and can build on `npm run dev`
before the backend deploys. F0 is the **only** story allowed to restructure shared files; it pre-creates a stub
for every file a later story owns. World: participant (`post/*`, `social/*`) plus the world-neutral `core/media`
(no UI, no theme). The controller never imports `PostCard` parts.

## Acceptance Criteria
- [ ] **PostCard decomposed, zero visible change.**
      `components/post/{PostCard,PostHeader,PostBody,PostMediaSlot,PostLinkCard,PostActions,PostReplyContext}.tsx`
      + `types.ts` + `index.ts`; `components/PostCard.tsx` re-exports so `@/features/social` imports are
      unchanged; `PostCard` already mounts `PostMediaSlot`, `PostReplyContext` (renders nothing without
      `inReplyTo`) and `PostActions`. Every existing `PostCard*.test.tsx` passes and the DOM hooks (`post-card`,
      `post-open-target`, `post-author-target`, `post-media`, `post-actions`, `data-action`) are unchanged.
- [ ] **Styles split per part.** The 418-line `theme/social.module.css` is split into
      `post/{PostCard,PostHeader,PostBody,PostMediaSlot,PostLinkCard,PostActions}.module.css`;
      `social.module.css` keeps only `.tokens` + shared custom properties (still consumed by
      `QuoteComposer`/`QuotePostCard`). No two Wave-2 stories share a CSS file.
- [ ] **Contract v2 types.** `types/post.ts` (`PostMedia` v2, `PostInReplyTo`, `PostViewerState`,
      `CreatePostMedia`, `EngagementBaseline`, `PostLinkPreview.imageUrl?`, `ReplyTarget`), `personas/types.ts`
      (`avatarUrl?`, `bannerUrl?`, `location?`), `core/media/types.ts` — exactly implementation.md §1.5/§1.11.
      `toParticipantView`, `feedService.isPost`/`assembleFeedView`, `useThread` guards and `personaService`'s
      `isValidPersona` carry/accept the v2 fields; a provenance-absence test proves
      `origin`/`actingHumanId`/`createdWallClock`/`injectId` are still structurally absent from
      `ParticipantPostView` (XC-002).
- [ ] **Mocks v2.** `services/mockFixtures.ts` + `postStore`/`seedCast` cover every item in implementation.md §5
      (grids 1–4, video with/without poster, thread with tombstone, viewer states, count boundaries,
      avatars/banners/locations, the impersonation pair, replies excluded from top-level but returned with
      `includeReplies`). `npm run dev` shows a finished-looking feed with no backend. `resolveFeed(scope, {
      includeReplies })` is added, and `personas/personaService.ts` exports `invalidatePersonas()` (a
      module-level version bump that makes `usePersonas`/`useStaffPersonas` refetch — they are
      `useState/useEffect` hooks, not React Query; PE-FE calls it after a save).
- [ ] **Upload client (`core/media/`).** `validateMediaFile` (size/MIME; hint text "MP4 (H.264)"),
      `captureVideoPoster`, `readImageSize`, `uploadMedia` (live: multipart via the shared axios client with
      progress + abort; **mock adapter**: object URLs, simulated progress, same error text as the server's
      413/415), `uploadVideoWithPoster` (poster first, then video with `posterMediaId`), `useMediaUpload`,
      `useMediaLibrary` (live `GET /api/staff/media`; mock: registry + 4 canned items). The client never sends
      an `exerciseId`.
- [ ] **`publishPost` v2.** `livePostActions.publishPost` sends `media[] {mediaId, alt, posterMediaId?}`,
      `parentPostId`, `engagementBaseline`, resolves with the parsed 201 view (participant or staff shape),
      **rejects on non-2xx and swallows nothing**; the legacy `{kind, alt}` placeholder is no longer sent. The
      mock path (`createPost`/`postStore`) honours the same inputs.
- [ ] **Engagement wiring relocated (behaviour-preserving, DP-14).** `PostActions` self-wires the existing
      local-optimistic `useReaction`/`useAmplify`; `pages/Feed.tsx`'s row and `components/ThreadView.tsx`'s
      `ThreadCard` stop wiring them (and stop mounting `QuoteComposer`); existing Feed/Thread action tests are
      updated, not deleted. `components/FeedSkeleton.tsx`, `components/media/MediaTabGrid.tsx` and
      `explore/ExplorePage.tsx` exist as minimal stubs mounted where their owners will fill them.
      `.gitattributes` adds `*.mp4 binary` and `*.webm binary`.

## Out of Scope
Any new UI behaviour (grids, player, composer attach, replies, URLs — those are F1–F6); persisted reactions
(F3); the realtime parser (F2); the router (F1). No controller UI. No new npm dependency.

## Technical Notes
- Files: implementation.md §4.1 row F0. Frozen after this story: `post/{PostCard,PostHeader,PostBody}.tsx`,
  `post/types.ts`, `social/index.ts` — later stories ask the orchestrator.
- Participant surface: CSS Modules only; **no COBRA, no MUI**, FontAwesome only. `core/media` stays
  world-neutral (it is imported by the staff world too).
- Mock/live flip is `USE_MOCK_DATA` (`core/config/mockData.ts`) — do not add a second flag. Mock details:
  implementation.md §5. Treat all ids as opaque strings.
- Scenario time: nothing here reads the wall clock for display; the lint ban on `new Date()`/`Date.now()` on
  participant paths stays.

## Dependencies
P2. Soft: P3 (Tom's stock clips) for the mock video. Blocks every Wave-2/3 frontend story. Independent of I1,
B1, B5.

## Tests
- Existing `PostCard.test.tsx`, `PostCard.hashtags.test.tsx`, `PostCard.authorTarget.test.tsx`,
  `QuotePostCard.test.tsx`, `Feed.actions.test.tsx`, `ThreadView.test.tsx` green after relocation.
- New `types/post.provenance.test.ts` (XC-002 structural absence), `services/feedService.v2.test.ts` (carries
  media/inReplyTo/viewer; includeReplies), `core/media/*.test.ts` (validation matrix incl.
  oversize/unsupported/video hint; mock upload returns a `MediaAssetView`, abort works, progress monotonic),
  `services/livePostActions.test.ts` (body shape, rejection propagates, no `exerciseId`).
- Scenario-time check: `PostCard` still renders relative/absolute time through `useScenarioTime`.
