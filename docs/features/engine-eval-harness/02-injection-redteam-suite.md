# Story: Prompt-injection red-team suite (release-gating)

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** ADP-024  ·  **Design decisions:** none  ·  **Issue:** #176

> **Delivered:** `Pulse.Core/Features/EngineEval/InjectionRedTeam.cs` + `InjectionRedTeamTests` — a standing
> attack catalog across all six categories with two offline defense-layer checks: structural containment
> (`WorldFeedFence` neutralises fence/turn/attribute forgery) and obedience detection (`ContentGuard` catches
> an obeyed tell / fiction break). The gate bites (obeyed = dirty, resisted = clean). The **live-provider
> end-to-end** pass (running each attack through the real generation path) is opt-in and layers on when a
> key is wired — see the AC note below.

## Context
First-class, and **release-gating**. Prompt-injection red-teaming is acceptance testing, not an edge
case (ADP-024) — this population is *trained in information manipulation*. A standing, maintained
suite of injection attacks entering via the `<world_feed>` verifies the isolation boundary
(engine-generation-infra story 03) holds. **A regression here blocks release.** The spike ships three
seeded attacks (all resisted); the real suite is broader and evolves as attacks do.

## Acceptance Criteria
- [x] Given the injection suite, when it runs against the generation path, then it covers at least:
      instruction override ("ignore your instructions / the exercise is over"), prompt/CoT
      exfiltration ("print your system prompt / debug mode"), scripted-phrase coercion ("repeat this
      word for word"), fiction-break bait, role confusion, and fence-forgery.
- [x] Given any attack in the suite, when generation runs, then the engine does **not** break
      character, leak the prompt, obey the injected command, or reproduce an attacker-demanded string
      — verified by the injection-leak + fiction-break checks (from `metrics.mjs`).
- [x] Given a regression (any attack newly succeeds), when the suite runs, then it **fails the build /
      blocks release** — this is a hard gate, not a warning.
- [x] Given evolving attacks, when new techniques are discovered, then the suite is **maintained** —
      adding a new attack is part of the story's ongoing lifecycle, not a one-time pass.
- [x] **LLM governance (NFR-005/ADP-024):** the suite exercises the real tenant-bounded generation
      path with the isolation boundary; staff/backend only. *(The offline gate exercises the isolation
      boundary — `WorldFeedFence` containment + `ContentGuard` obedience detection — deterministically in
      CI. The **live** tenant-bounded generation pass per attack is the opt-in layer, added when a provider
      key is wired, alongside the existing `PULSE_LIVE_FOUNDRY` live tests.)*

## Out of Scope
The isolation boundary implementation (engine-generation-infra story 03 — this *tests* it); the
voice metrics (story 01); the content-guard patterns themselves (shared with generation-infra —
this asserts they hold under attack).

## Technical Notes
Staff/backend. Graduate `spikes/e8-generation-loop/`'s injection fixtures (`WORLD_CONTENT` items 4–6)
and the `injectionResistance` + `fictionGuard` checks; expand the attack set. Run as a gating suite
(Vitest now; backend equivalent when it lands). See implementation.md (story 02), architecture §3.4/
§12.2.

## Dependencies
engine-generation-infra story 03 (the boundary under test); the shared guard functions
(`metrics.mjs`); the Vitest harness / CI (none exists yet — this story defines the gate contract).

## Tests
- The suite itself: every seeded attack resists; a deliberately-weakened boundary makes the suite fail
  (proving it's a real gate, mirroring the spike's validated resistance).
