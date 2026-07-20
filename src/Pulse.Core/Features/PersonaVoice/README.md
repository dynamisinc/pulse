# Feature: Persona voice engine

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/persona-voice-engine/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §5
**Issue:** #128 (stories #148–#151)

The believability core: how one persona stays **consistent** across an exercise while personas stay
**diverse** across a burst. Pure backend domain logic — it *produces* the generation-facing
`PersonaDossier` the merged `PromptAssembler` consumes and *scores* the resulting burst with the merged
`VoiceMetrics`; it does not edit `Features/Generation` or `Features/EngineEval` (consumed read-only). No
E2/E7 dependency, no participant surface. Exercise-scoped (COR-001 / XC-001): conditioning uses only the
persona's own exercise content — no cross-exercise leak.

## The seams

| Type | Role |
|---|---|
| `Models/PersonaVoiceProfile.cs` | The engine's owned voice model (§5.1): voice notes + seed style + type + audience + this-exercise post history. `PersonaDossier` is its projection. |
| `Services/VoiceProfileBuilder.cs` | Voice consistency (#148, ADP-020): `RefreshStyle` from post history (cold-start → seed), `SelectExemplars` (2–3 recent), `ToDossier` (folds persona-type guidance into the trusted voice notes). |
| `Services/PersonaCasting.cs` | Persona-type behavior + bad-actor gating (#150, ADP-022): `Guidance(type)`, `IsBadActor`, `EligibleCast(cast, badActorsEnabled)`. |
| `Services/StyleConformance.cs` | The consistency half of the metric (#151): does one post conform to its persona's style (length/emoji/hashtag/caps) within tolerance? |
| `Services/BurstAcceptancePolicy.cs` | The believable + diverse gate (#149/#151): combines `VoiceMetrics` diversity + per-persona `StyleConformance` → pass/fail with named failing checks; `Decide` → accept / re-roll / drop. |
| `Services/StyleAnalysis.cs` (internal) | Shared deterministic text heuristics: emoji/hashtag/length/caps. |

## Design decisions worth knowing

- **The diversity metric already exists** in `EngineEval.VoiceMetrics` (max pairwise trigram overlap,
  distinct-2, per-persona distinctiveness). This feature adds the **consistency half** (style conformance)
  and combines both into one gate — so `BurstEvaluation.Passed` requires diversity **and** every persona
  staying on its own voice. A burst can be diverse yet have one persona drift off-voice, and that fails.
- **Burst-in-one-call** is the `PromptAssembler`'s model (`PostCount = personas.Count`); this feature relies
  on it (a seam test proves N eligible personas → one N-post call) and scores the result.
- **Re-roll, never surface converged content** (§5.2): `Decide` re-rolls a failing burst up to a bound, then
  drops it (the caller logs the drop, XC-004) rather than showing low-quality content to a human.
- **Persona-type behavior is trusted context** (NFR-005): guidance is folded into the dossier voice notes,
  never sourced from untrusted world content; adversarial types (troll/bot) reassert the fiction guard.
- **Bad actors are gated** (ADP-022): troll/bot personas are excluded from a burst unless the storyline/
  scenario enables them.

## Status

| Story | State |
|---|---|
| 01 Voice consistency — dossier + prior-post conditioning (#148) | Done — `VoiceProfileBuilder` (style refresh, exemplars, cold-start fallback, `ToDossier`). |
| 02 Cross-persona diversity — burst + thresholds (#149) | Done — `BurstAcceptancePolicy` over `VoiceMetrics`; bounded re-roll → drop. |
| 03 Persona-type behavior + bad-actor gating (#150) | Done — `PersonaCasting`. |
| 04 Believable + diverse acceptance metric (#151) | Done — `StyleConformance` + `BurstAcceptancePolicy.Evaluate` (shared with engine-eval-harness). |

Consumed by the `reaction-loop` decide/generate stages (eligible cast + burst request + the re-roll gate)
and the reactive behaviors; the metric is shared with `engine-eval-harness` story 01.
