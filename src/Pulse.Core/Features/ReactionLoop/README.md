# Feature: Reaction loop (observe + decide cores)

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/reaction-loop/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §1.2 / §2
**Issue:** #130 (stories #157–#160)

The scenario-time orchestration that turns storyline state into public reaction. This slice ships the two
**pure** front stages — **observe** (#157) and **decide** (#158) — plus the decide-stage **behavior
registry** the reactive behaviors plug into. The back stages **generate→review→publish** (#159) and
**measure** (#160) are intentionally **not built here**: they integrate with the E2 publish pipeline and
the E7 review cockpit, neither of which exists yet. This slice produces the `GenerationIntent` those
stages will consume.

Pure backend domain logic — no E2/E7 dependency. Builds on the merged `Storylines`, `Autonomy`, and
`Generation.Models` read-only; the eligible cast is supplied as input (persona-voice applies the bad-actor
gate upstream), so this slice does not depend on the persona-voice slice.

## The seams

| Type | Role |
|---|---|
| `Services/ObserveStage.cs` (#157) | `Observe(storylines, addressing, clock) → ObservedSignals`: raises inaction triggers when a storyline's silence window elapses in scenario time; surfaces official posts / off-platform markers as addressing **candidates** (matching is response-reaction's job — never treats an unmatched post as silence, ADP-002a). |
| `Services/IntentComposer.cs` (#158) | Pure base composition: folds curve/phase (tone), dial-target follow (`TargetFollow`), rate caps/floors (`RateGovernance`), and the resolved autonomy level into a `GenerationIntent` — or null (stopped / no cast / throttled). |
| `Services/DecideStage.cs` (#158) | Routes each trigger to the registered `IReactionBehavior`, else the default composer. `Register(behavior)` is the extension point the reactive behaviors plug into (one per trigger kind). |
| `Models/GenerationIntent.cs` | The decide output `{storyline, personas, toneMix, count, tier, autonomyLevel, trigger}` — what the generate stage will carry out. |
| `Models/ReactionContext.cs` | The per-storyline decide input (storyline + trigger + autonomy + eligible cast + rate snapshot + scenario minute). |
| `Models/ReactionSignals.cs` | `ObservedSignals`, `InactionTrigger`, `AddressingObservation`/`AddressingCandidate`. |

## Design decisions worth knowing

- **Scenario time is inherited, not re-implemented** (COR-050/051): observe reads each storyline's
  `MinutesSinceLastOfficialResponse`, which the loop advances via `Storyline.Tick` against the scenario
  clock — so a freeze accrues no silence and a time-jump advances it, tested end-to-end through the storyline.
- **The dial target overrides the curve** (CTL-022): with a target set the intent's burst size follows
  `TargetFollow` toward the target (below-target → taper → no new burst); with no target it follows a small
  phase-sized curve burst. Everything is cap-bounded (ADP-011) — the intent never breaches the per-minute cap.
- **Autonomy gates generation**: a stopped engine (kill switch) produces no intent; otherwise the intent is
  annotated with the effective level (Suggest / Delayed-auto) so the review stage routes correctly.
- **The behavior registry is the reactive-behavior extension point**: silence-escalation (Inaction),
  response-reaction (OfficialResponse), amplification (Amplification), ambient-chatter (AmbientFloor) each
  register a policy; the default `IntentComposer` handles anything unregistered.

## Status

| Story | State |
|---|---|
| 01 Observe stage — triggers + inaction timers (#157) | Done — `ObserveStage` (scenario-time inaction triggers + addressing candidates). |
| 02 Decide stage — generation intent (#158) | Done — `IntentComposer` + `DecideStage` + the behavior registry. |
| 03 Generate → review → publish (#159) | **Blocked** — needs the E2 publish pipeline + E7 review cockpit (#34–36). |
| 04 Measure stage (#160) | **Blocked** — needs E2 downstream signals + the XC-004 emitter (E1). |

Consumed by the reactive behaviors (silence-escalation, response-reaction, amplification, ambient-chatter),
which register decide-stage policies against the behavior registry.
