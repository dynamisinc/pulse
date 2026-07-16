# Implementation: Autonomy & safety

> The safety layer. Staff-world; integrates with the ALREADY-BUILT engine-review-cockpit (#34–36) and
> world-steering — E8 produces exactly what they consume. Backend .NET absent; the autonomy state +
> the auto-HOLD/kill-switch/workload contracts are the seams.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Autonomy levels | Per-exercise autonomy state + per-storyline overrides; read by reaction-loop dispatch. | `services/autonomy/level` | `autonomyFor(exercise, storyline) → Suggest \| Delayed` |
| 02 Auto-HOLD wiring | Timed-draft terminal action = HOLD (default); swamped-mode flag (#36) is the only send path. | `services/autonomy/timeout` | timed-draft terminal-action contract for cockpit #35 |
| 03 Kill switch | One control → Suggest/stop instantly; suspends in-flight countdowns; no auto-recovery. | `services/autonomy/killSwitch` | `killSwitch(mode)`; shared "autonomy only down" invariant |
| 04 Workload contract | Demand signal + the demand-reduction design; eval-enforced ≤6/min. | `services/autonomy/demand` | demand signal → queue-pressure meter; the CTL-034 budget |

## Reuse map
- **engine-review-cockpit (#34 queue / #35 auto-HOLD+NEEDS-YOU / #36 swamped-mode)** — E8 produces the timed drafts + terminal action these consume; do not rebuild their UI.
- **world-steering / live-monitoring** — the queue-pressure (demand) meter (D5-014/2.7); the tiered-pause state.
- **engine-generation-infra story 05** — degraded-mode fallback is the automatic sibling of the kill switch (shared invariant + console surface).
- **reaction-loop** — routes drafts per autonomy level (dispatch); burst-level review is a loop design decision.
- **response-reaction story 03** — match suggestion reduces demand.
- E1 **roles** (lead-controller gate, swamped mode) + **clock** (Delayed-auto countdown).
- Telemetry emitter (`XC-004`) — autonomy changes, HOLD/auto-send transitions, kill-switch trips, demand.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Autonomy levels | autonomy/level | reaction-loop dispatch, E1 roles/clock | — | 1 | M |
| 02 Auto-HOLD wiring | autonomy/timeout | 01, engine-review-cockpit #35/#36 | 03 | 2 | M |
| 03 Kill switch | autonomy/killSwitch | 01, generation-infra 05 | 02 | 2 | S |
| 04 Workload contract | autonomy/demand | 01–03, response-reaction 03, eval-harness | — | 3 | M |

Levels first (01). Auto-HOLD (02) + kill switch (03) are the two safety controls (wave 2). The
workload contract (04) sits on top and is verified by the eval harness. All integrate with the
already-built cockpit + world-steering — those are contract seams, not rebuilds.
