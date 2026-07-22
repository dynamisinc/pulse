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
| 01 Hashtags | hashtags, HashtagFeed (+ isolated `PostCard.tsx` text-render edit — see seam below) | posts; feeds render | reactions/01, amplification/01, profiles-social-graph/01 (files disjoint) | 1 | S |
| 02 Trending | trending, TrendList | 01; activity | — | 2 | M |
| 03 Recompute | trending recompute | 02; isolation | — | 2 | S |

### Integration seam (orchestrator-owned — never a wave story)
Hashtag linkification is a self-contained edit to `PostCard.tsx`'s text-render block (`<p>{post.text}</p>`)
only — no new prop, no `Feed.tsx`/`ThreadView.tsx` caller wiring — and no other Wave-1 story touches
that specific block (`reactions/01`/`amplification/01` both touch the action-row block instead), so
**story 01 may land this edit directly** rather than deferring it. Reaching the hashtag feed from a
tap, however, IS a shared view-composition change:

| Seam | File(s) | Rule |
|------|---------|------|
| Channel view composition | `features/social/SocialChannel.tsx` | Phase 1 has no cross-channel router (local `useState`, mirrors the existing `openThreadId` pattern) — opening `HashtagFeed` needs a new view-state branch here. Shared with `profiles-social-graph/01`'s "open a profile" wiring. Orchestrator-owned, serial, in Wave 2 after both stories land their own pages. |

Build `hashtags.ts` + `HashtagFeed.tsx` (+ the isolated `PostCard.tsx` text edit) and their unit/RTL
tests standalone in Wave 1; the `SocialChannel.tsx` "open hashtag feed" wiring is a Wave-2 orchestrator
pass alongside profile navigation. AC2 ("tapping a hashtag opens its feed") is not fully verifiable
end-to-end until that pass lands.
