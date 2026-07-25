# Implementation: Feeds & discovery

> The participant-world burst surface. Real-time is a **buffered pill, never auto-scroll/live-insert**
> (D1-005). The feed read API (`GET /api/feed`) and the SignalR realtime host (`/hubs/exercise`,
> `PostReceived`) are now **built and wired** (Social API B1, `docs/features/social-api/`) — story
> 04's `feedStreamSource.ts` flips mock↔realtime on `USE_MOCK_DATA`, with the NFR-003 polling
> fallback already live. Search (story 03) has no backend endpoint of its own yet and remains
> mock-only until its own contract lands.

> **Wave-1 cross-feature integration slice (story 07).** A minimal slice of story 04's real-time
> update lands early, as one of a 5-story cross-feature Wave-1 wave alongside `console-shell/01`
> (KEYSTONE) and `persona-operation` 01–03, so a controller-published post
> (`persona-operation/01`'s `onPublished`) can appear in the feed. Story 07 is the **only** story in
> this Wave-1 composition touching `features/social/*`; it does not import any `controller`/
> `persona-operation` file, and those stories do not import `postStore` — the integration step wires
> `onPublished → postStore.appendPost`. Story 04 remains the full follow-up and this doc's own Wave
> Plan (below) is unaffected for stories 01–06.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 All Posts | Virtualized chronological global feed. | `features/social/pages/Feed.tsx`, `hooks/useFeed.ts` | `<Feed>`, `useFeed()` |
| 02 Following | Follow-edge-filtered feed (`FeedScope` param on the story-01 read seam; server-side filter live, `GET /api/feed?scope=following`). Tab UI itself is a separate integration pass — see the story's Technical Notes for the exact `<Feed scope>` mount point. | Edits to `features/social/pages/Feed.tsx`, `hooks/useFeed.ts`, `services/feedService.ts` (no new files) | `FeedScope`, `<Feed scope?>`, `useFeed(scope?)`, `resolveFeed(scope?)`, `setMockFollowingForTests()` (test-only) |
| 03 Search | Scoped full-text + Top/Recent + People. | `features/social/pages/Search.tsx`, `hooks/useSearch.ts` | `useSearch()` |
| 04 New-posts pill | Buffer + sticky pill; SignalR + polling fallback. | `features/social/components/NewPostsPill.tsx`, `hooks/useFeedStream.ts` | `useFeedStream()` |
| 05 For You (stretch) | Engagement ranking, config-gated. | `features/social/services/forYouRank.ts` | — |
| 06 PIO columns | Grant-gated column layout over feed/search streams. | `features/social/components/ColumnsMode.tsx` | `<ColumnsMode>` |
| 07 Live post store (Wave-1 slice) | Module-singleton post store the mock feed adapter + `useFeed()` read/subscribe to, so an appended post surfaces live (newest-first) through the existing `aria-live="polite"` region — no pill, no SignalR. | `features/social/services/postStore.ts` (new); edits to `feedService.ts`, `useFeed.ts` | `postStore` (`getPosts()`, `appendPost()`, `subscribe()`, `resetForTests()`) |

## Reuse map
- `<PostCard>` (posts); profiles follow edges; hashtags-trending + search; `<VerifiedMark>` (People)
- Scenario-time (COR-053); isolation (COR-001); telemetry (XC-004); observer/read-only (COR-015/D1-011)
- **SignalR real-time host (Phase 1)** — `useFeedStream` (04) + notifications share it; polling fallback (NFR-003)
- Burst strategy shared with notification aggregation (notifications/02) — bounded buffer, aria-live=polite
- E1 org grants (COR-018) — PIO columns gating (06)
- **Shipped `postService.ts`** (`listPosts`, `toParticipantView`) — story 07's `postStore` seeds from
  `listPosts()` and never bypasses `toParticipantView`'s narrowing (XC-002)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 All Posts | Feed, useFeed | posts (PostCard) | 03 | 1 | M |
| 03 Search | Search, useSearch | posts; profiles; hashtags | 01 | 1 | M |
| 02 Following | Feed Following source | 01; profiles edges | 04 | 2 | S |
| 04 New-posts pill | NewPostsPill, useFeedStream | 01; SignalR host | 02 | 2 | M |
| 06 PIO columns | ColumnsMode | 01, 03, 04; E1 COR-018 | 05 | 3 | M |
| 05 For You (stretch) | forYouRank | 01, 04; exercise-config | 06 | 3 | S |
| 07 Live post store (Wave-1 slice) | postStore, feedService/useFeed edits | 01 (shipped) | — (this pass — cross-feature Wave-1 composition with `console-shell/01` + `persona-operation` 01–03) | 1* | S |

\* Story 07 lands in the SAME calendar wave as 01's dependents for this pass's cross-feature
composition, but is not itself a dependency of 02/03/05/06 — it is additive to story 01's shipped
seam. Treat its "Wave 1" as "this pass's Wave 1," not a reordering of the feature's own internal
sequencing.
