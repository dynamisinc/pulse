# Implementation: Storyline model

> The engine's state layer. Backend .NET absent; these stories define the storyline schema + the
> intensity/sentiment/curve/cap/target mechanics the reaction loop reads. The escalation dial UI
> already exists (world-steering #25) and sets the target this feature follows.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Object + state machine | Storyline entity + phase transitions; reserved `expectedActionRef`/`rumorRefs`. | `models/Storyline`, `services/storyline/stateMachine` | `Storyline` type; `transition(storyline, event)` |
| 02 Intensity + sentiment | Tick update (curve + time + response + amplification); sentiment blend. | `services/storyline/intensity`, `services/storyline/sentiment` | `tickIntensity(...)`, `computeSentiment(...)`; feeds E10 |
| 03 Escalation curves | Named `(rise, decay, ceiling, floor)` profiles. | `services/storyline/curves` | `CURVES` registry; `curveFor(name)` |
| 04 Rate caps + quiet floors | Per-exercise cap enforcement + floor signal. | `services/storyline/rateGovernance` | `withinCap(exercise)`, `belowFloor(exercise)` (ambient subscribes) |
| 05 Dial-target follow loop | Read `targetIntensity`; modulate the decide-stage intent. | `services/storyline/targetFollow` | `intentModulation(storyline) → {raise/lower/hold}` |

## Reuse map
- E1 **exercise clock (COR-050/051)** — scenario time for `responseWindowMin` / time-since-response.
- E1 exercise-context / query-scoping layer — storylines are exercise-scoped, staff-only.
- persona-management — `participatingPersonas`, SOC-054 audience magnitude (intensity bend).
- **world-steering escalation dial (#25)** — sets `targetIntensity`; this feature follows it (D5-014/2.2).
- E2 reactions (SOC-031) + amplification (SOC-054) — sentiment + intensity inputs.
- Telemetry emitter (`XC-004`) — `storyline.state_changed`, `engine.measured`, steering-action logs.
- E10 / EVL-014 — consume sentiment/intensity with dial-input overlays.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Object + state machine | models/Storyline, stateMachine | E1 context layer | — | 1 | M |
| 03 Escalation curves | services/storyline/curves | 01 | 04 | 2 | S |
| 04 Rate caps + quiet floors | rateGovernance | 01 | 03 | 2 | S |
| 02 Intensity + sentiment | intensity, sentiment | 01, 03, E2 signals | — | 3 | M |
| 05 Dial-target follow loop | targetFollow | 01–04, dial #25 | — | 4 | M |

Object first (01). Curves + caps are independent config layers (wave 2). Intensity/sentiment (02)
needs the curve. The dial-follow loop (05) needs the full state + the #25 target. Frontend→backend
edge serial; the `Storyline` type + `tickIntensity`/`intentModulation` signatures are the seams.
