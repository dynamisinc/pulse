# Implementation: Engine telemetry & tuning

> ADP-041 engine-action logging extending the XC-004 v0 schema + the tuning/observability surface.
> Backend .NET absent; the event types + query surface are the seams. Schema mistakes are cross-phase
> migrations (adversarial review D2) — extend XC-004, do not fork it.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Engine event types | Additive event types on the XC-004 envelope; every E8 feature emits them; reserve `rumor.*` + lineage. | `telemetry/engineEvents` (schema) | the engine event-type definitions every E8 feature emits |
| 02 Tuning & observability surface | Read/query view over the engine event log; overlay data for E10. | `services/tuning/observability` | query API + EVL-014 overlay data for E10 |

## Reuse map
- **XC-004 v0 telemetry emitter (E1)** — the base envelope + emitter; engine events extend it (additive), never fork it.
- Every E8 feature — emits these event types (reaction-loop, storyline-model, response-reaction, autonomy-safety, amplification-engine, silence-escalation).
- **E10** — the primary consumer (timeline, replay, metrics); this surface feeds it.
- **E9 INT-031** — shares the taxonomy (the event stream).
- **EVL-014** — dial-input overlay semantics (designed vs participant-driven pressure).
- storyline-model — the curve/rate-cap/threshold config a tuner adjusts.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Engine event types | telemetry/engineEvents | E1 XC-004 v0 emitter | — | 1 | M |
| 02 Tuning & observability surface | services/tuning/observability | 01, E10 consumer contract, EVL-014 | — | 2 | M |

Event types first (01) — they are the shared dependency every other E8 feature emits against, so this
is near-foundation and should land early alongside storyline-model. The observability surface (02) is
a view over them. Frontend→backend edge serial; the event schema is the seam E10/E9 consume.
