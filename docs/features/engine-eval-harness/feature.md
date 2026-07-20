# Feature: Engine eval harness

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** testing / acceptance
**World:** staff / backend  ·  **Issue:** #137

## Summary
How we *prove* the engine is believable and safe — the acceptance gate, not a test folder bolted on
at the end. Four suites: voice-diversity & fidelity checks (ADP-021), a maintained release-gating
prompt-injection red-team (ADP-024), latency/cost SLO measurement (NFR-002/003), and end-to-end
scenario reaction-correctness tests ("did the world react correctly to action *and inaction*?").

## Requirements covered
ADP-021 (diversity checks in acceptance), ADP-024 (injection red-team as acceptance testing), the
epic's eval-harness ask (architecture §12), NFR-002/003 (latency/cost SLOs), CTL-034 (the workload
scenario test).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §12 (the eval harness, four suites). Prototype:
`spikes/e8-generation-loop/{metrics.mjs,index.mjs}` (voice metrics + injection fixtures, self-validated).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Voice-diversity & fidelity checks | ADP-021 | Complete | #175 |
| 02 | Prompt-injection red-team suite (release-gating) | ADP-024 | Complete | #176 |
| 03 | Latency/cost SLO measurement | NFR-002/003 | Pending (needs live-provider pass) | #177 |
| 04 | Scenario reaction-correctness tests | §12.4 / ADP-001/002a / CTL-034 | Blocked (needs the full loop) | #178 |

**Story 02 delivered:** the maintained injection red-team suite ships as `Pulse.Core/Features/EngineEval/
InjectionRedTeam.cs` (+ `InjectionRedTeamTests`) — a standing attack catalog across every category with two
defense-layer checks that hold without a live model: **structural containment** (the `WorldFeedFence`
neutralises fence/turn/attribute forgery) and **obedience detection** (`ContentGuard` catches an obeyed
tell / fiction break). Additive to the merged EngineEval slice; no edits to `ContentGuard`/`WorldFeedFence`.
The opt-in live-provider end-to-end pass layers on when a key is wired. Story 01 (voice-diversity checks)
reuses the persona-voice believable+diverse metric and lands with that slice; 03/04 need a live provider /
the full reaction loop.

## Dependencies
`persona-voice-engine` (the metric functions it shares), `engine-generation-infra` (provider + prompt
+ isolation to test; the cost/latency spike seeds the SLO), `reaction-loop` + `storyline-model` +
`response-reaction` + `silence-escalation` + `autonomy-safety` (the behaviors the scenario tests
exercise). Vitest 4 + RTL is the frontend harness (CLAUDE.md); backend xUnit lands with the backend.

## Design notes
Staff/backend. This is the **acceptance gate**: a regression in the injection red-team (story 02) or
the miss-safe scenario test (story 04) **blocks release**. The voice metrics (story 01) and injection
fixtures (story 02) are graduated from the self-validated spike (`spikes/e8-generation-loop/`). The
scenario suite (story 04) is the hardest and most important — it asserts the loop reacts correctly to
action *and inaction*, honors the miss-safe default (anti-berate-the-PIO), and holds the CTL-034
workload budget.
