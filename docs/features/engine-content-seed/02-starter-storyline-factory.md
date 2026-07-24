# Story: Starter storyline factory — one canned, in-memory storyline  `[backend]`

**Feature:** engine-content-seed  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** Not Started
**Requirements:** E8 arch §1.1 ("Storylines are created by planners (pre-seeded) or controllers (ad
hoc)"), §6.1 (state machine — arming via `Seed`) — consumption of the already-built `storyline-model`,
not new storyline-model logic  ·  **Design decisions:** none  ·  **Issue:** #326

## Context
`ReactionLoopRegistration.Storylines` must be non-empty for the loop to have anything to observe/decide
on (`ReactionLoopHost.cs`'s own doc: a `ReactionLoopRegistration` needs "a non-empty `Storylines` list").
`storyline-model` (Phase 2, `Complete`) shipped the domain object and its factory
(`Storyline.Create(...)` / `.Seed(scenarioMinute)`) but — by design — no persistence (`DbSet<Storyline>`)
and no authoring endpoint; storylines today exist only as objects a caller constructs in code (exactly
as the `engine-runtime` test harness does via its own `SeededStoryline` helper).

This story is that construction, made reusable: given the cast seeded by story 01, build **one** canned
storyline matching the shipped frontend mock's Fairhaven narrative
(`src/frontend/src/features/controller/services/storylineMock.ts`'s `seedStoryline()` — same title, same
fictional arc) so a demo/pilot exercise's engine content is narratively consistent with what the
controller console's escalation-dial mock already displays. The instance this factory returns is
**in-memory only** — see `feature.md`'s "Storyline persistence — deliberately deferred" note for the
accepted Phase-1 limitation this implies (a restart or a re-seed discards accrued progress).

## Acceptance Criteria
- [ ] **Given** a set of seeded persona handles (story 01's output) and an `exerciseId`, **when**
  `StarterStorylineFactory.Build(exerciseId, personaHandles, options)` runs, **then** it returns one
  `Storyline` via the existing `Storyline.Create(...)` factory with: title `"Water main contamination
  fears"`, expectation `"an official statement from Fulton County Emergency Management addressing the
  water safety concern"`, curve `"Standard"`, hashtags `["#WaterIssues"]`, and `ParticipatingPersonas`
  ordered **citizens first** — `mvega_fh`, `tbrandt41`, `kwardFH`, then `Newsline7`, `FairhavenWater`,
  `FulcoEM` — so that the reaction loop's `IntentComposer.Compose` (which takes the eligible cast in
  list order via `EligiblePersonas.Take(allowed)`) picks anxious citizen voices for the first, smaller
  bursts before the official/outlet accounts — matching ADP-001's "the vacuum fills with worry and
  speculation before officials speak" framing, not an arbitrary order.
- [ ] **Given** a caller-supplied `responseWindowMinutes` (optional), **when** `Build` runs, **then**
  `ResponseWindowMin` is set to that value; when omitted, it defaults to **3 scenario minutes** — a
  deliberately short, demo/pilot-tuned window (not the ~20-minute window used in illustrative tests
  elsewhere), because scenario minutes advance 1:1 with real wall-clock time (`ExerciseClockService`, no
  acceleration multiplier) and a controller running this seed should see the first review-queue item
  within a few real minutes, not twenty. The value is clamped to a documented sane bound (1–180 minutes)
  regardless of what is supplied.
- [ ] **Given** the built `Storyline`, **when** `Build` returns it, **then** `.Seed(0)` has already been
  called — `Dormant → Seeded`, tick baseline anchored at scenario minute 0 — so it is immediately
  eligible for `ObserveStage`/`MeasureStage` on the very next loop tick after registration, with no
  further setup.
- [ ] **Isolation (COR-001).** The returned `Storyline.ExerciseId` always equals the `exerciseId`
  parameter — the same field `ReactionLoopDriver.BuildReviewItem` defensively re-checks against the
  tick's resolved scope and **throws** on mismatch (a documented WR-001 defense-in-depth guard); this
  factory must never let a stale or foreign `exerciseId` slip through untouched.
- [ ] **Pure / stateless.** `Build` has no `PulseDbContext`, no I/O, and no shared mutable state — calling
  it twice with the same inputs is safe and yields two fully independent `Storyline` instances, so a
  re-seed call (story 03) can always rebuild a fresh one without any hidden coupling to a prior call.

## Out of Scope
`DbSet<Storyline>` persistence or a planner-facing storyline-authoring endpoint (flagged in `feature.md`
as a real, deferred follow-up — not half-built here). More than one concurrent storyline (Phase-1 seeds
exactly one arc). Rumor lineage / `contradiction-reaction` hooks (v1.1, the reserved `RumorRefs` slot
stays empty). Automatic/detected storylines (E8 arch §13.1 — controller/planner-seeded only, per the
epic's own v1 decision). Any change to `Storyline`, `StorylineStateMachine`, `EscalationCurves`, or any
other `storyline-model` file — this story only **calls** the existing factory.

## Technical Notes
Backend, ops-only — a pure static factory needing no DI registration (the same house convention as
`AccountFieldRules`: a stateless static class). Owns
`src/Pulse.WebApi/Features/Ops/EngineContentSeed/StarterStorylineFactory.cs`.

**Reuse, do not reinvent:** `Pulse.Core.Features.Storylines.Models.Storyline.Create(...)` / `.Seed(int)`
verbatim — no new storyline-model logic, no new curve, no new state-machine transition. The exercise
brief string this feature's registration (story 03) pairs with the storyline
(`"Fairhaven is a mid-size municipality responding to a suspected water-main contamination event near
its treatment plant."`) is a companion constant, not owned by this file (see story 03's Technical Notes)
— keeps this factory's signature narrowly about the `Storyline` object itself.

**Signature:** `StarterStorylineFactory.Build(Guid exerciseId, IReadOnlyList<string> personaHandles,
StarterStorylineOptions? options = null) -> Storyline`, where `StarterStorylineOptions` carries the
optional `responseWindowMinutes` override described above. `personaHandles` is accepted as a plain list
of handle strings — **no** dependency on story 01's `PersonaCastSeeder` type, keeping this file's build
graph independent of story 01's (a data dependency at call time in story 03, not a compile-time one).

## Dependencies
Story 01's output (the seeded persona **handles**, not its implementation) is what story 03 will pass
into `Build` — a runtime data dependency, not a file/type dependency, so this story can be built in
parallel with story 01 (file-disjoint, no shared symbols).

## Tests
xUnit (`Pulse.Core.Tests` or `Pulse.WebApi.Tests`, no DB / no `RequiresDockerFact` needed — pure): `Build`
returns a storyline in `StorylinePhase.Seeded` at scenario minute 0; `ParticipatingPersonas` matches the
citizens-first order exactly for the six-handle input; a custom `responseWindowMinutes` is honored, and
an out-of-bound value (e.g. `0` or `500`) is clamped into `[1, 180]`; `ExerciseId` round-trips exactly for
two different exercise ids called back to back (no shared static state leaking between calls).

**Delivered tests** (`Pulse.WebApi.Tests/Features/Ops/EngineContentSeed/StarterStorylineFactoryTests.cs`, pure `[Fact]`/`[Theory]`):
- `Build_SetsTheCannedFairhavenConstants` (AC1 — title/expectation/curve/hashtags)
- `Build_OrdersParticipatingPersonasCitizensFirst` + `Build_AppendsUnknownHandlesLastWithoutDropping` (AC1 — order)
- `Build_DefaultsResponseWindowToThreeDemoTunedMinutes` / `Build_HonorsACustomResponseWindow` / `Build_ClampsAnOutOfBoundResponseWindow` (AC2)
- `Build_ArmsTheStorylineAtScenarioMinuteZero` (AC3 — `.Seed(0)`)
- `Build_RoundTripsTheExerciseId` (AC4 — COR-001)
- `Build_IsStateless_TwoCallsYieldIndependentStorylinesForDifferentExercises` (AC5 — pure/stateless)
