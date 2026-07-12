# Implementation: Feeds & discovery

> The participant-world burst surface. Real-time is a **buffered pill, never auto-scroll/live-insert**
> (D1-005). Backend not present — feed/search queries + the SignalR host are the contract seam; mock
> now with polling fallback designed in (NFR-003).

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 All Posts | Virtualized chronological global feed. | `features/social/pages/Feed.tsx`, `hooks/useFeed.ts` | `<Feed>`, `useFeed()` |
| 02 Following | Follow-edge-filtered feed + tabs. | (extends Feed with a Following source) | — |
| 03 Search | Scoped full-text + Top/Recent + People. | `features/social/pages/Search.tsx`, `hooks/useSearch.ts` | `useSearch()` |
| 04 New-posts pill | Buffer + sticky pill; SignalR + polling fallback. | `features/social/components/NewPostsPill.tsx`, `hooks/useFeedStream.ts` | `useFeedStream()` |
| 05 For You (stretch) | Engagement ranking, config-gated. | `features/social/services/forYouRank.ts` | — |
| 06 PIO columns | Grant-gated column layout over feed/search streams. | `features/social/components/ColumnsMode.tsx` | `<ColumnsMode>` |

## Reuse map
- `<PostCard>` (posts); profiles follow edges; hashtags-trending + search; `<VerifiedMark>` (People)
- Scenario-time (COR-053); isolation (COR-001); telemetry (XC-004); observer/read-only (COR-015/D1-011)
- **SignalR real-time host (Phase 1)** — `useFeedStream` (04) + notifications share it; polling fallback (NFR-003)
- Burst strategy shared with notification aggregation (notifications/02) — bounded buffer, aria-live=polite
- E1 org grants (COR-018) — PIO columns gating (06)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 All Posts | Feed, useFeed | posts (PostCard) | 03 | 1 | M |
| 03 Search | Search, useSearch | posts; profiles; hashtags | 01 | 1 | M |
| 02 Following | Feed Following source | 01; profiles edges | 04 | 2 | S |
| 04 New-posts pill | NewPostsPill, useFeedStream | 01; SignalR host | 02 | 2 | M |
| 06 PIO columns | ColumnsMode | 01, 03, 04; E1 COR-018 | 05 | 3 | M |
| 05 For You (stretch) | forYouRank | 01, 04; exercise-config | 06 | 3 | S |
