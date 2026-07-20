# Story: Storyline escalation dial — actual + target, engine follows

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-022 (ADP-010)  ·  **Design decisions:** D5-014/2.2  ·  **Issue:** #25

## Context
The controller's intensity control for automated public reaction. The D5 review **amended** it from a
single value to **one track showing actual fill + a controller-set target tick**: the controller
clicks the track to set a target ("78 → 60"), and the **engine drives actual toward the target**.
This ships in **Phase 1** as an engine cockpit foundation (CTL-022) so the E8 engine (Phase 2) lands
into a ready control.

> **Amendment (D5-014/2.2).** Before: intensity shown as a single value. After: one track = actual
> fill + a target tick; click to set target; the engine drives actual toward target.

> **Phase 0 reconciliation (done).** The "actual" side of the track is not invented — it mirrors the
> FROZEN `Storyline` model (`Pulse.Core/Features/Storylines/Models/Storyline.cs`) field-for-field via
> a small TS mock (`storylineMock.ts`, see `implementation.md`): `Intensity` (int, 0–100),
> `TargetIntensity` (int?, null = unset), `Phase` (mirrors `StorylinePhase`, rendered UPPERCASE per
> `StorylineBriefProjection.PhaseLabel`, e.g. `ESCALATING`). **Resolved contract note:** the D5 brief
> places this control inside the toolstrip's "Stories" flyout (not yet built); Wave 1 builds
> `<EscalationDial>` container-agnostic so the orchestrator can mount it in `ControllerConsole.tsx`'s
> `flex: 1` work area now and re-parent it into the Stories flyout later with no rework — see
> `implementation.md`'s Integration seam note. This story does **not** edit `ControllerConsole.tsx`.

## Acceptance Criteria
- [ ] Given a storyline, when the console renders its escalation control, then it shows **one
      track** with the **actual** intensity as a fill (0–100, from the mock storyline's `Intensity`)
      and a distinct **target** tick (from `TargetIntensity`, absent when unset).
- [ ] When the controller clicks or drags the track to a position, then the target updates to that
      value (0–100, clamped), is recorded on the mock storyline (mirroring
      `Storyline.SetTargetIntensity`), and the displayed relationship text reads the transition (e.g.
      `"78 → 60"`, or `"none → 60"` the first time a target is set).
- [ ] The control is also settable by **keyboard** (e.g. arrow keys nudge the target tick; Home/End
      jump to 0/100) with no loss of the click/drag behavior (NFR-001).
- [ ] The storyline's current **phase label** renders alongside the track, uppercase, exactly as
      `StorylineBriefProjection.PhaseLabel` would produce (e.g. `ESCALATING`, `PEAK`) — text, not a
      color-only phase indicator.
- [ ] Once the E8 engine is present (Phase 2), the engine drives actual intensity **toward the
      target** per the storyline's escalation profile (ADP-010, `Storyline.Tick`'s
      `TickTowardTarget` path); in Phase 1 the target is captured and exposed
      (`useStorylineTarget()`'s return value) for that loop to consume later — the follow loop itself
      is a stub/no-op this pass.
- [ ] Setting or clearing a target emits a `steering_action` telemetry event (XC-004) — `channel:
      'system'`, `actor: { kind: 'system', actingHumanId, role }`, `target: { entityType:
      'storyline', entityId }`, `payload` carrying the before/after detail string — and is scoped to
      the active exercise (`exerciseId` stamping-only, COR-001) and staff-only (XC-002).
- [ ] Actual fill vs. target tick is distinguishable **without color alone** (NFR-001) — e.g. a solid
      fill vs. a distinct tick marker/label, not merely two hues.

## Out of Scope
The engine's generation behavior (E8 ADP-001/002/004); escalation-profile definitions (E8 ADP-010);
the real engine-follows-target tick loop (Phase 2 — `Storyline.Tick`'s `TickTowardTarget` branch runs
server-side; this story only exposes the target); the review queue (engine-review-cockpit); the
"Stories" toolstrip flyout / storyline board (D5-016, mocked elsewhere, not this story); mounting
`<EscalationDial>` into `ControllerConsole.tsx` (orchestrator-owned integration seam).

## Technical Notes
Staff world (COBRA). Owns `features/controller/components/steering/EscalationDial.tsx`,
`features/controller/hooks/useStorylineTarget.ts`, and
`features/controller/services/storylineMock.ts` (the TS mirror of the frozen `Storyline` contract —
`Intensity`, `TargetIntensity`, `Phase` label, kept disjoint from story 03's files). `Sentiment` is
carried on the mock for future reuse (e.g. a Stories flyout sentiment bar) but has no UI in this
story. Telemetry follows the same `buildAndEmit` shape as
`features/controller/engine/services/reviewActions.ts`'s `emitReviewed()` (channel `'system'`), with
`actor.kind: 'system'` (not `'engine'` — this is a controller/system action on world state, not
engine-authored content). One-track actual+target is the canonical widget; container-agnostic per
the Phase 0 note above. See `implementation.md` (story 02) for the reuse map and Wave Plan.

## Dependencies
None to start Wave 1 (the mock storyline is self-contained); `useControllerIdentity()` and
`@/core/telemetry` (both shipped) for attribution/logging. E8 storyline model + escalation profiles
(ADP-010, Phase 2) for the real follow loop; the orchestrator-owned mount into `ControllerConsole.tsx`
lands after this story and story 03 both merge. Ticks STORY-UPDATES.md §A **CTL-022**.

## Tests
- Component (RTL): the track renders actual fill + a target tick; clicking/dragging the track sets a
  target and updates the "X → Y" text; arrow-key/Home/End keyboard interaction also sets the target.
- Unit: `useStorylineTarget()`'s target-change is recorded on the mock storyline (mirroring
  `SetTargetIntensity`'s from/to detail string) and emits one `steering_action` telemetry event with
  the correct actor/target/payload.
- Unit: the phase label renders uppercase and matches `StorylineBriefProjection.PhaseLabel`'s mapping
  for each `StorylinePhase` value.
- Unit/axe: actual vs. target is distinguishable by an automated contrast/text check, not color
  alone.
