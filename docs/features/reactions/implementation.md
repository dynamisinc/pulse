# Implementation: Reactions

> Participant-world reactions over `<PostCard>`; the sentiment set is telemetry-analytical but
> participant-invisible as such. Backend not present — reaction writes are the contract seam.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 Like | Like toggle + count on the action row. | `features/social/hooks/useReaction.ts` | `useReaction()` |
| 02 Sentiment set | Config-gated picker; telemetry aggregation to mood. | `features/social/components/ReactionPicker.tsx` | `<ReactionPicker>` |

## Reuse map
- `<PostCard>` action row (posts); telemetry (XC-004); exercise-config enablement (D1-002)
- Feeds E8 mood input (ADP-012) + E10 sentiment (EVL-014)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Like | useReaction | posts (PostCard) | amplification/01, hashtags-trending/01 (files disjoint — see seam below) | 1 | S |
| 02 Sentiment set | ReactionPicker | 01; exercise-config; XC-004 | — | 2 | M |

### Integration seam (orchestrator-owned — never a wave story)
`useReaction()` is self-contained and buildable/testable in isolation, but wiring the like control
INTO the live post action row touches files this story does not own outright — `amplification/01`
converges on the exact same files for its own (repost) action, so neither builder may land these
edits standalone:

| Seam | File(s) | Rule |
|------|---------|------|
| Post action row | `features/social/components/PostCard.tsx` | Add `onLike`/`likedByViewer` to `PostCardProps` and wire the `like` entry in the actions-row render — the same block/function `amplification/01` must also edit for `repost`. Orchestrator-owned, serial, in Wave 2 after both stories land their own hooks/services. |
| Feed row wiring | `features/social/pages/Feed.tsx` (`FeedRow`/`FeedRowProps`) | Thread `useReaction()`'s handlers into the `<PostCard>` call (mirrors the existing `onReply`/`onOpenThread` wiring at line ~90). Same file `amplification/01` needs. |
| Thread wiring | `features/social/components/ThreadView.tsx` (3 `<PostCard>` call sites) | Same wiring, all three sites. Same file `amplification/01` needs. |

Build `useReaction.ts` + its unit tests standalone in Wave 1 against the CURRENT `PostCard` contract
(mock/stub the callback in tests); the orchestrator applies the action-row/Feed/ThreadView wiring in
one serial pass once both `01`s have landed. Story 01's Status should not move to Complete until that
integration pass lands and its own AC (control renders in the action row) is verified end-to-end.
