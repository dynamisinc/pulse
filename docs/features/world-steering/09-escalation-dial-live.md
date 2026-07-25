# Story: Escalation dial live — real storyline, real target-chase, and the missing explanatory UX

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-022 (ADP-010), COR-001, XC-002, XC-004, NFR-001  ·  **Design decisions:** D5-014/2.2 (see story 02)  ·  **Issue:** #352

> **Definition of done includes verified-in-UAT, not just unit-green.** As with stories 07/08: not
> Complete on green tests alone. It must be confirmed live, mock off — setting a target above
> current intensity on a real, running storyline must visibly move actual intensity toward that
> target over subsequent ticks, with no manual engine action.

## Context
Story 02 shipped a correct, well-tested dial UI — actual fill, target tick, phase label, keyboard
support — entirely against `storylineMock.ts`, an in-memory TS mirror of the frozen `Storyline`
contract that is connected to nothing real. The number the dial shows is not a real storyline, and
setting a target goes nowhere.

The backend half is already built and unused. `Storyline.SetTargetIntensity` records a target;
`TargetFollow.Modulate` computes a raise/lower/hold decide-stage signal from the gap to target; and
— the key finding this session — **`Storyline.Tick` already drives `IntensityModel.TickTowardTarget`**
whenever `TargetIntensity` is set and the storyline is in `Escalating` or `Peak` phase (see
`Storyline.cs`, the `Tick` method's `next = TargetIntensity is int target && Phase is ... ?
TickTowardTarget(...) : Tick(...)` branch). This runs on every `ReactionLoopDriver.RunTickAsync`
call via `MeasureStage.Measure`. So the engine-follows-target chase this story needs is **already
wired inside the tick** — what's missing is only the endpoint pair that lets a controller reach the
live `Storyline` object at all, and the frontend swap from the mock to that endpoint. Storylines
live in **process memory**, not the database — the singleton `ReactionLoopRegistry`
(`ReactionLoopHost.cs`) holds the live `Storyline` domain objects the loop ticks directly — so this
story needs **no EF migration**: the endpoint calls `SetTargetIntensity` on the very object in the
registry, and the next tick picks it up.

Per this session's decision, both asks are folded into this one story: wire the dial for real, AND
add the explanatory UX (what the 0–100 scale means, actual vs. target, what the phase label is
telling you) that the D5-amended dial never got. See `docs/features/world-steering/feature.md` and
this feature's `implementation.md` for the reuse map and Wave Plan.

## Acceptance Criteria
- [ ] Given a controller-assigned, running exercise with a registered storyline, when
      `<EscalationDial>` mounts in live mode, then it fetches the real storyline (a new
      `GET /api/steering/storylines/{storylineId}` reading directly off the `IReactionLoopRegistry`
      registration the reaction loop ticks) and renders its actual `Intensity`, `TargetIntensity`,
      and `Phase` — not `storylineMock`.
- [ ] Given the controller clicks/drags/keys a new target, when the change commits, then
      `POST /api/steering/storylines/{storylineId}/target` calls `Storyline.SetTargetIntensity` on
      the SAME in-memory object the loop ticks (no shadow/duplicate storyline) and returns the
      updated actual/target/phase so the dial's optimistic local update reconciles against the
      authoritative response.
- [ ] Given a target is set on a storyline in `Escalating` or `Peak` phase, when the reaction
      loop's subsequent ticks run, then actual intensity measurably moves toward the target — the
      "engine drives actual toward target" behavior — **with no new reaction-loop or
      intensity-model code**, per the Context note; this AC verifies the existing `Tick`/
      `TickTowardTarget` path is actually reached once a live target exists.
- [ ] Given a storyline OUTSIDE `Escalating`/`Peak` (e.g. `Seeded`, `Addressed`, `Decaying`), when a
      target is set, then the dial's explanatory copy honestly states the target will not move
      intensity until the storyline reaches an escalating/peak phase — mirroring `Storyline.Tick`'s
      own gating — never silently implying an immediate chase that will not happen.
- [ ] Given the dial, the explanatory UX this story adds answers, in place: what the 0–100 scale
      means (a one-line plain-language legend, e.g. "0 = quiet · 100 = crisis-level attention"),
      which value is actual vs. target (a labeled legend, not just relative position on the track),
      and what the current phase label means (a one-line description on hover/focus, e.g.
      `ESCALATING` → "gaining attention, no qualifying response yet") — never color-only (NFR-001).
- [ ] Given `USE_MOCK_DATA` is true (the dev/UAT default), then `<EscalationDial>`/
      `useStorylineTarget()` behave **exactly** as story 02 shipped them against `storylineMock.ts`
      — this story adds a live branch; story 02's existing tests pass unchanged.
- [ ] Isolation (COR-001/XC-002) and telemetry (XC-004): both endpoints are staff-only and scoped
      to the caller's assigned exercise (reusing `EngineCockpitStaffAuthorizationFilter` unmodified)
      — a storyline id from another exercise returns `404`, never that exercise's data; the live
      target-change POST still emits exactly one `steering_action` event, unchanged in shape from
      story 02.

## Out of Scope
The "Stories" toolstrip flyout / storyline board listing multiple storylines (D5-016/017, still
not built — this story stays container-agnostic exactly as story 02 was, and reads a single
storyline id the same way story 02's mock did); creating or seeding new storylines (still
controller/planner pre-seed only, unchanged); real-time SignalR push of actual-intensity changes
(this story polls/refetches on an interval, no new hub event — kept file-disjoint from story 08's
broadcaster work); re-opening a `Resolved` storyline; any pause/freeze/Break-Fiction behavior
(stories 04/07/08).

> **Correction (Gate-1, W-004): `TargetFollow.Modulate` is NOT unwired — an earlier draft of this
> story was wrong about the shipped codebase.** A prior version of this section claimed "wiring
> `TargetFollow.Modulate`'s output into the DECIDE stage" was out of scope / not yet done. That is
> incorrect: `DecideStage.Decide` already falls back to `IntentComposer.Compose` for the inaction
> trigger this story's target feeds, and `IntentComposer.Compose` already calls
> `TargetFollow.Modulate` to size the requested burst — this has been shipped and unmodified since
> before this story started. So setting a live target via this story's endpoint affects BOTH the
> MEASURE-stage chase (`Storyline.Tick`/`TickTowardTarget`, this story's actual subject, verified in
> `StorylineTargetChaseIntegrationTests`) AND the DECIDE-stage burst direction/count
> (`TargetFollow.Modulate`'s raise/lower/hold), on the very next tick. Nobody building against this
> story — or verifying it in UAT — should be surprised that setting a target also changes how many
> posts the engine suggests, not only the dial's actual-fill number. No code in this story wires
> `TargetFollow.Modulate`; it was already live before this story touched anything.

## Technical Notes
Staff world (COBRA). **Backend:** a new file,
`src/Pulse.WebApi/Features/EngineRuntime/Steering/StorylineSteeringEndpoints.cs` (same `Steering/`
folder as stories 07/08's files, but a **separate file** — keeps this story file-disjoint from
both), exposing the `GET`/`POST` pair described above, reading/writing directly against the
`Storyline` objects held in the registration's `Storylines` list on the SAME `IReactionLoopRegistry`
singleton `ReactionLoopHost` ticks — **no new EF entity, no migration** (the audit's key finding:
storylines are process-memory only). Reuses `EngineCockpitStaffAuthorizationFilter` unmodified.
**Frontend:** `useStorylineTarget.ts` gains a live branch (mirrors `useReviewQueue`'s
`USE_MOCK_DATA` split) backed by a new `liveStorylineActions.ts` (POST, modeled on
`liveEngineControlActions.ts`) and a `liveStorylineStore.ts` (GET + interval refetch, modeled on
`liveReviewStore.ts`'s GET-seeds/reconcile shape, minus the SignalR subscription — this story polls
rather than pushes, to stay file-disjoint from story 08). Poll interval should roughly match
`ReactionLoopHostOptions.TickInterval`'s 5-second default so the dial visibly advances without
over-polling; a documented follow-up may later replace this with a push mirroring story 08's
pattern. `<EscalationDial>` gains the explanatory legend/tooltip as additional, static UI (not
per-exercise configured copy). **Caveat, stated honestly (state-persistence limitation, not fixed
by this story):** `IReactionLoopRegistry` is in-memory — an App Service restart clears it, losing
any previously-set target and de-registering the loop; recovery is the existing
`POST /api/ops/seed-engine-content` re-seed path. See `implementation.md` for the reuse map and
Wave Plan.

## Dependencies
The shipped, frozen `Storyline`/`TargetFollow`/`IntensityModel`/`StorylineBriefProjection`
contracts (`Pulse.Core/Features/Storylines/`); the shipped `IReactionLoopRegistry`/
`ReactionLoopHost` (engine-runtime, on `main`); the shipped `EngineCockpitStaffAuthorizationFilter`;
story 02 (the mock dial UI — this story adds a live branch alongside it, unchanged). Independent
of stories 07/08 — no shared endpoint file, no shared frontend service file — may build in
parallel with them. The orchestrator-owned `Program.cs` wiring for the new `Add*`/`Map*` pair
lands as a serial step after Gate-2, same #310→#317 caution as the other two stories.

## Tests

> **AC ↔ test linkage (Gate-1 W-007).** Added post-review so the mapping from each Acceptance
> Criterion to its concrete proof is explicit and auditable, not just narrative. This section is
> descriptive of what exists; it does not change scope.

- **AC1** (GET reads the live registry storyline) —
  `Pulse.WebApi.Tests/Features/EngineRuntime/Steering/StorylineSteeringEndpointsTests.cs`:
  `GetStoryline_ByRealId_ReturnsActualTargetPhase_FromTheLiveRegisteredStoryline`,
  `GetStoryline_ByPrimarySentinel_ResolvesToTheCallersOwnFirstStoryline`.
- **AC2** (POST mutates the SAME object; the dial reconciles against the authoritative response) —
  backend: `StorylineSteeringEndpointsTests.SetTarget_HappyPath_MutatesTheSameRegistryObject_AndReturnsTheUpdatedState`
  (asserts `BeSameAs` the original registry object); frontend:
  `useStorylineTarget.test.ts`'s `'AC2: setTarget POSTs to the resolved storyline id, updates
  optimistically, then reconciles against the authoritative response'`.
- **AC3** (the existing `Tick`/`TickTowardTarget` chase is reached, no new engine code) —
  `Pulse.WebApi.Tests/Features/EngineRuntime/Steering/StorylineTargetChaseIntegrationTests.cs`:
  `TwoConsecutiveTicks_WithATargetAboveCurrentIntensity_NarrowTheActualToTargetGap_WithNoNewEngineCode`,
  `Tick_OnceActualReachesTheTarget_HoldsThereRatherThanOvershooting`, and (W-005, composed
  end-to-end through the actual service rather than a hand-called stand-in)
  `Composes_SetTargetAsync_ThenTwoTicks_NarrowTheGap_ProvingTheServiceReachesTheSameChase`.
- **AC4** (the honesty caveat outside Escalating/Peak) —
  `EscalationDial.test.tsx`'s `'EscalationDial — the honesty caveat (story 09, AC4; live mode to
  control phase precisely)'` describe block (states the target, the rule, AND the current phase;
  absent with no target; absent on a chasing phase).
- **AC5** (the explanatory UX — scale legend, actual-vs-target meaning legend, phase-meaning
  tooltip) — `EscalationDial.test.tsx`'s `'EscalationDial — explanatory UX (story 09, AC5)'`
  describe block. The phase tooltip test additionally locks in Gate-1 W-003 (`describeChild` —
  the phase label's OWN accessible name must survive the tooltip, never replaced by it).
- **AC6** (the mock path is unchanged) — story 02's original `EscalationDial.test.tsx` /
  `useStorylineTarget.test.ts` cases all pass unmodified (verified additive-only by numstat at
  Gate-1); every new live-mode test lives in its own `describe` block gated by the
  `USE_MOCK_DATA` toggle.
- **AC7** (isolation + telemetry) — backend IDOR/auth coverage in
  `StorylineSteeringEndpointsTests.cs` (`GetStoryline_ForeignExerciseStorylineId_Returns404_...`,
  `SetTarget_ForeignExerciseStorylineId_Returns404_AndNeverMutatesIt`, the 401/403 gate cases) plus
  the corrupt-registration defense-in-depth guard (Gate-1 W-002) in
  `StorylineSteeringServiceUnitTests.cs`; telemetry shape-parity in both hook test files'
  `'emits exactly ONE steering_action event, unchanged in shape from the mock branch'` cases.
- **Gate-1 CR-001** (never claim an unconfirmed/failed change) —
  `useStorylineTarget.test.ts`'s `'a rejected POST (Gate-1 CR-001 + S-003)'` describe block;
  `EscalationDial.test.tsx`'s `'write failures are surfaced, never silent (Gate-1 CR-001, live
  mode)'` describe block.
- **Gate-1 CR-002** (never fabricate a calm world) —
  `useStorylineTarget.test.ts`'s `'dataStatus (Gate-1 CR-002 — never fabricate a calm world)'`
  describe block; `EscalationDial.test.tsx`'s `'never fabricate a calm world (Gate-1 CR-002, live
  mode)'` describe block; `liveStorylineStore.test.ts`'s status-transition coverage.
- **Gate-1 W-001** (the sentinel is exact, never a wildcard) —
  `StorylineSteeringServiceUnitTests.cs`'s
  `GetAsync_ANonSentinelNonGuidLiteral_Returns404_NeverWildcardsToTheFirstStoryline` (a `Theory`
  over `"undefined"`, `"null"`, a typo, wrong casing, stray whitespace).
- **Gate-1 W-006** (reference-counted poll lifecycle) — `liveStorylineStore.test.ts`'s
  `'reference-counted lifecycle (Gate-1 W-006)'` describe block;
  `useStorylineTarget.test.ts`'s `'Gate-1 W-006: acquires the poll reference on mount and releases
  it on unmount'`.
- **Gate-1 W-008** (the dial names what it is steering) — `EscalationDial.test.tsx`'s `'names what
  it is steering (Gate-1 W-008)'` describe block.
- Regression: `USE_MOCK_DATA=true` — story 02's existing test suite passes unchanged.
- **Manual/UAT (required for Complete):** with mock off, set a target above current intensity on an
  Escalating storyline in the console; observe (via repeated GET or a page refresh) that actual
  intensity rises toward the target over subsequent ticks with no manual engine action. Per the
  W-004 correction above, also expect the DECIDE-stage burst count/direction to respond to the same
  target — that is the pre-existing `TargetFollow.Modulate` behavior, not a regression.
