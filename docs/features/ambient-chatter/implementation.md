# Implementation: Ambient chatter

> Single-wave feature. ADP-005 background posting that fills the quiet floor on the Haiku tier. Backend
> .NET absent; plugs into the reaction-loop decide registry as a lowest-priority policy.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports |
|-------|----------|-----------------------|---------|
| 01 Ambient background posting | Low-priority decide-stage policy triggered by the quiet-floor signal; Haiku-tier ambient bursts that yield to storyline-critical intents. | `services/behaviors/ambient/policy` | ambient behavior policy (reaction-loop registry) |

## Reuse map
- **`storyline-model` story 04** — `minBelievableActivity` quiet-floor signal + `maxEnginePostsPerMinute` cap.
- **`persona-voice-engine`** — voiced ambient posts (ordinary background life).
- **`engine-generation-infra` story 04** — Haiku-tier selection (cost).
- **`reaction-loop`** — decide (policy registry, lowest priority), generate/publish.
- E1 exercise clock (COR-053 scenario-time rendering); persona backdated history (COR-023) for continuity.
- Telemetry emitter (`XC-004`).

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Ambient background posting | ambient/policy | storyline-model 04, voice-engine, generation-infra 04, reaction-loop | — | 1 (single wave) | S |

Single wave. The one dependency edge that matters: the quiet-floor signal (storyline-model story 04)
must exist for the trigger. Frontend→backend edge serial.
