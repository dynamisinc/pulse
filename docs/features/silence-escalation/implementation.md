# Implementation: Silence escalation

> The ADP-001 inaction behavior, built on the reaction loop's observe→decide→generate stages. Two
> stories: the scenario-time timer semantics, and the escalating content policy. Backend .NET absent.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Inaction timer → trigger | ADP-001 silence semantics over reaction-loop's observe timers; "qualifying response" = matched social post or off-platform marker. | `services/behaviors/silence/trigger` | inaction-trigger signal into decide |
| 02 Escalating content | Decide-stage policy mapping inaction trigger + intensity → anxious/speculative intent; escalates per curve. | `services/behaviors/silence/policy` | registered behavior policy (reaction-loop registry) |

## Reuse map
- **`reaction-loop`** — observe (timer substrate), decide (policy registry), generate/publish/measure.
- **`storyline-model`** — `responseWindowMin`, escalation curve, intensity update.
- **`persona-voice-engine`** — voiced anxiety/speculation bursts + diversity gate.
- **`engine-generation-infra`** — tenant-bounded provider + isolation + guard.
- **off-platform marker (#29)** + **response-reaction** — define what "matched/qualifying" means; a match stops escalation.
- E1 **exercise clock (COR-050/051)** + pause (#26) — scenario-time windows.
- Telemetry emitter (`XC-004`).

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Inaction timer → trigger | silence/trigger | reaction-loop observe (01), storyline-model | — | 1 | S |
| 02 Escalating content | silence/policy | 01, reaction-loop decide (02), voice-engine, response-reaction | — | 2 | M |

Trigger first, then the content policy that consumes it. Both plug into the reaction-loop registry;
response-reaction must define "matched" for the trigger's negative case (a serial edge with
response-reaction).
