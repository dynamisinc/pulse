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
| 01 Like | useReaction | posts (PostCard) | — | 1 | S |
| 02 Sentiment set | ReactionPicker | 01; exercise-config; XC-004 | — | 2 | M |
