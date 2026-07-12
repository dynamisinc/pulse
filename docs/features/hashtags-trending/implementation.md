# Implementation: Hashtags & trending

> Participant-world hashtags + an organic, exercise-scoped trending list biased (never set) by the E7
> boost-weight lever. Backend not present — trend recompute is the contract seam.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 Hashtags | Parse/linkify + hashtag-feed route. | `features/social/utils/hashtags.ts`, `pages/HashtagFeed.tsx` | `parseHashtags()` |
| 02 Trending | Activity-weighted ranking + boost-weight input. | `features/social/services/trending.ts`, `components/TrendList.tsx` | `<TrendList>` |
| 03 Recompute | Scoped windowed recompute ≤60s. | (backend) trending recompute | — |

## Reuse map
- posts (text/PostCard); feeds-discovery (feed rendering for hashtag feeds); telemetry (XC-004)
- E7 CTL-021 boost-weight (biases input); E8 ADP-004 (organic push); search (SOC-082)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Hashtags | hashtags, HashtagFeed | posts; feeds render | 02 | 1 | S |
| 02 Trending | trending, TrendList | 01; activity | 01 | 2 | M |
| 03 Recompute | trending recompute | 02; isolation | — | 2 | S |
