# Implementation: Amplification engine

> ADP-004 spread simulation over the E2 amplification substrate (#85). Two stories: the repost/quote/
> react mechanics, and the velocity/trend shaping. Backend .NET absent; the E2 amplification pipeline
> already exists as a Phase-1 feature.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Repost / quote / react | Decide-stage policy driving E2 amplification via engine personas; reserve `mutationOf` on quote-posts. | `services/behaviors/amplify/spread` | amplify behavior policy; quote-post with reserved `mutationOf` |
| 02 Velocity + trend push | Velocity = f(intensity, SOC-054); organic trend bias; bends intensity up; cap-bounded. | `services/behaviors/amplify/velocity` | `spreadVelocity(storyline, personas)`; the substrate rumor `spreadProfile` builds on |

## Reuse map
- **E2 amplification (#85)** — repost/quote/reaction mechanics + the reconstructable chain (SOC-022); the engine drives it, doesn't reinvent it.
- **`reaction-loop`** — decide (policy registry), generate/publish/measure.
- **`storyline-model`** — intensity (in: shapes velocity; out: bent up by spread), rate caps.
- **`persona-voice-engine`** — quote-post voice + bad-actor eligibility.
- **SOC-054 audience magnitude** (persona attribute) + **hashtags-trending (SOC-041)** — velocity + organic trend push.
- Telemetry emitter (`XC-004`) — spread/velocity events; feeds E10 + v1.1 rumor lineage.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Repost / quote / react | amplify/spread | reaction-loop, E2 amplification #85, voice-engine | — | 1 | M |
| 02 Velocity + trend push | amplify/velocity | 01, storyline-model (intensity/caps), SOC-054, SOC-041 | — | 2 | M |

Mechanics first (01), then the velocity/trend shaping (02). Both plug into the reaction-loop registry
and the E2 amplification pipeline; the quote-post `mutationOf` slot is the v1.1 rumor seam.
