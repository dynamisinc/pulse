# Story: Decide stage — generation intent

**Feature:** Reaction loop  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** F8.1, ADP-010/011  ·  **Design decisions:** none  ·  **Issue:** #158

> **Delivered:** `ReactionLoop/Services/IntentComposer` (base composition: curve/target/cap + autonomy →
> `GenerationIntent`) + `DecideStage` with the `IReactionBehavior` registry the reactive behaviors plug
> into. Tests: `IntentComposerTests` + `DecideStageTests`. The `engine.decided` telemetry AC is deferred
> with #173 (blocked on the E1 XC-004 base).

## Context
Given the observed signals, the decide stage produces a **generation intent**: which personas, what
tone mix, how many posts, at what tier — derived from the storyline rules + escalation curve + rate
caps/quiet floors + the dial-target follow + the current autonomy level. The intent is what the
generate stage (story 03) hands to the generation infra; it is the seam the reactive behaviors
(silence-escalation, response-reaction, amplification, ambient-chatter) shape.

## Acceptance Criteria
- [x] Given observed triggers + storyline state, when the decide stage runs, then it emits a
      generation intent `{storyline, personas, toneMix, count, tier}` consistent with the storyline's
      curve (story 03 of storyline-model) and the dial target (story 05 of storyline-model).
- [x] Given rate caps / quiet floors (ADP-011), when intent is formed, then it respects
      `maxEnginePostsPerMinute` (won't request a burst that breaches the cap) and honors
      `minBelievableActivity` (drives ambient intent when below floor). *(Cap enforced in
      `IntentComposer` via `RateGovernance.WithinCap`; the `AmbientFloor` trigger + Ambient tier are wired,
      but detecting below-floor and firing ambient is `ambient-chatter`'s behavior policy.)*
- [x] Given the autonomy level, when intent is formed, then it is annotated with the level
      (Suggest / Delayed-auto) so the review stage (story 03) routes correctly.
- [x] Given the dial target, when set, then the intent's intensity/volume is modulated toward it
      (via storyline-model's target-follow), not the raw curve.
- [ ] **Telemetry (XC-004):** the decision emits an `engine.decided` event (intent, autonomy,
      rate-cap state, trigger) — staff-only (XC-002). *(Deferred with `engine-telemetry-tuning` #173, which
      is blocked on the E1 XC-004 base envelope; the intent carries the trigger + autonomy so the emitter
      has everything to log when it lands.)*

## Out of Scope
Observing the triggers (story 01); the generation call + review routing + publish (story 03); the
specific behavior policies (silence-escalation / response-reaction / amplification / ambient-chatter
supply the trigger-specific intent shaping); persona selection *voice* mechanics (persona-voice-engine).

## Technical Notes
Staff/backend. The decide stage is the composition point: it reads storyline-model (curve, caps,
target), the autonomy level (autonomy-safety), and the eligible personas (persona-voice-engine
story 03), producing an intent. Reactive-behavior features register the trigger→intent policies. See
implementation.md (story 02) and architecture §1.2.

## Dependencies
Story 01 (observed signals); storyline-model (curve/caps/target); autonomy-safety (level);
persona-voice-engine (eligible personas). Feeds story 03. Reactive behaviors shape the intent.

## Tests
- Unit: intent respects the cap, honors the floor, is annotated with the autonomy level, and is
  modulated by the dial target.
- Unit: `engine.decided` emitted with the trigger + intent.
