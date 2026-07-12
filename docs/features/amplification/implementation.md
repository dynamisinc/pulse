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
| 01 Repost/quote | amplify, QuotePostCard | posts (PostCard, Composer) | — | 1 | M |
| 02 Counts | PostCard aggregates | 01 | 03 | 2 | S |
| 03 Chain | amplification telemetry | 01; XC-004 | 02 | 2 | S |
