# Implementation: Amplification (reposts & quotes)

> Participant-world spread mechanics over `<PostCard>`; every event is telemetry (the E10/E8 raw
> material). Backend not present — amplification writes are the contract seam.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 Repost/quote | Amplification record + quote-embeds-post. | `features/social/services/amplify.ts`, `components/QuotePostCard.tsx` | `repost()`, `quotePost()` |
| 02 Counts | Queryable repost/quote aggregates on the card. | (extends PostCard) | count aggregates |
| 03 Chain | Parent-linked amplification events → derivable tree. | (backend) amplification telemetry | chain reconstruction |

## Reuse map
- `<PostCard>`, `<Composer>` (posts); scenario-time (COR-053); telemetry (XC-004); audience magnitude (SOC-054)
- Feeds E8 amplification (ADP-004) + E10 spread metrics

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Repost/quote | amplify, QuotePostCard | posts (PostCard, Composer) | reactions/01, hashtags-trending/01 (files disjoint — see seam below) | 1 | M |
| 02 Counts | PostCard aggregates | 01 | 03 | 2 | S |
| 03 Chain | amplification telemetry | 01; XC-004 | 02 | 2 | S |

### Integration seam (orchestrator-owned — never a wave story)
`amplify.ts`/`<QuotePostCard>` are self-contained and buildable/testable in isolation (a repost/quote
fits the existing append-only `postStore.appendPost` seam — no count mutation needed here, that's
story 02), but wiring the repost affordance INTO the live post action row touches files this story
does not own outright — `reactions/01` converges on the exact same files for its own (like) action:

| Seam | File(s) | Rule |
|------|---------|------|
| Post action row | `features/social/components/PostCard.tsx` | Add `onRepost`/`onQuote` to `PostCardProps` and wire the `repost` entry in the actions-row render — the same block/function `reactions/01` must also edit for `like`. Orchestrator-owned, serial, in Wave 2 after both stories land their own hooks/services. |
| Feed row wiring | `features/social/pages/Feed.tsx` (`FeedRow`/`FeedRowProps`) | Thread the repost/quote handler into the `<PostCard>` call (mirrors the existing `onReply`/`onOpenThread` wiring at line ~90). Same file `reactions/01` needs. |
| Thread wiring | `features/social/components/ThreadView.tsx` (3 `<PostCard>` call sites) | Same wiring, all three sites. Same file `reactions/01` needs. |

Build `amplify.ts` + `<QuotePostCard>` + their unit tests standalone in Wave 1 against the CURRENT
`PostCard` contract; the orchestrator applies the action-row/Feed/ThreadView wiring in one serial pass
once both `01`s have landed. Story 01's Status should not move to Complete until that integration pass
lands and its own AC (repost/quote controls render in the action row) is verified end-to-end.

**Landed (Wave-S3.1 integration, commit `9d935b8`):** the repost/quote controls ARE wired into
`<Feed>`'s live action row and emit telemetry end-to-end (`pages/Feed.actions.test.tsx`) — that part of
the integration is done. Story 01 remains **In Progress**, not Complete: AC1's "appears in the
audience's feed attributed 'X reposted'" clause is still not wired (no new feed row is inserted, no
count bump) — Gate-2 finding WR-004, tracked to land with `amplification/02`. See the story's Deferred
section.
