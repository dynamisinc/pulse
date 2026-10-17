# Story: Engine state survives a restart — the kill switch and the cut-to-Fake lever hold, the loop comes back by itself  `[backend] [SAFETY-CRITICAL] [TIER-2 schema]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** Ready (decisions recorded 2026-10-17) — **gated** (see Gates); build post-demo
**Requirements:** ADP-042 (kill switch / degraded mode), ADP-040 (review queue), CTL-034, ADP-011, ADP-002a, COR-001, XC-004, NFR-005, NFR-003 (E8 arch §8.1/§8.2/§8.4)  ·  **Design decisions:** D5-014/1.1 (auto-HOLD, never auto-send; inherited, not re-decided)  ·  **Issue:** —
**Wave:** Session C wave C3 (`docs/NEXT-WAVE-SESSION-BRIEF.md` §C4)  ·  **World:** staff/backend. No participant surface; the only UI touch is one staff banner on the existing controller engine cockpit (COBRA).

## Context

Every per-exercise engine control lives in process memory and is lost on every deploy or App Service restart.
`demo-feedback/18` already fixed the pause tier, the exercise clock and the overlay (`ExerciseRuntimeState`); it
explicitly left "engine loop registrations, storylines, autonomy level or the kill switch" out of scope. This story
is that remainder.

**The main risk is that a restart silently re-enables live egress.** Today:

- The kill switch (`EngineAutonomyState`: `_safetyClamp`, `_stopped`) is gone, so the exercise is back at the
  Suggest floor with no stop, and the controller's "engine stopped" banner disappears with no human having cleared it.
- The cut-to-Fake lever (`GenerationProviderCutRegistry`, the proven egress kill switch from #402) is gone, so
  `GenerationProviderSelector` routes that exercise to the configured **live** provider again
  (`GenerationProviderSelector.cs:97`). The controller cut the exercise to Fake, the app restarted, and the next
  generation call goes to Azure OpenAI.
- The degraded-mode clamp (NFR-003) is gone, though the next circuit trip re-applies it.

The reaction loop is not ticking after a restart (the registry is empty), so for a loop-driven exercise the live
egress is dormant until someone re-runs `POST /api/ops/seed-engine-content`. That is a manual step that builds a
**fresh** `EngineAutonomyState` and finds an empty cut set, so the re-seed itself is where the fail-open happens.
Any generation path that does not depend on the loop registry (a draft re-roll from the cockpit) reads the
selector directly and is exposed from the first request after the restart. Removing the manual re-seed (this
story's second goal) would remove the only human pause in that sequence, so persistence of the lowering state
must land **with** the auto-reload, never after it.

The rest of the loss is operational: the loop registration (storylines, cast), the storyline arc (intensity, phase,
last official response), the tier policy and the ambient policy all reset. `UAT-GOLIVE-RUNBOOK` (not yet on `main`
at the time of writing; the same restart losses are recorded in `05-live-provider-uat-golive.md` Out of Scope and
`engine-content-seed/feature.md` "Registration lifecycle after a restart") carries a manual re-seed step. The goal
is that step disappears.

**Safety principle: fail closed on restart.**

- State that **lowers** the engine's reach (kill switch, FullStop, degraded clamp, cut-to-Fake) is restored
  exactly, with no human step, and a restore failure resolves to the **more restrictive** reading.
- State that **raises** the engine's reach (autonomous ambient, Delayed-auto default or override, swamped mode ON,
  auto-confirm of response matches) is **persisted but not auto-restored**. The exercise boots at the floor
  and the controller is shown what was set before, with a one-click, logged, lead-gated "restore" (open question
  Q1; this is a proposal for Tom, not a decision).
- Automation never raises its own autonomy (E8 §8.2). A boot-time reload that quietly re-armed Delayed-auto would be
  the engine raising itself on a schedule nobody chose.

### Inventory: what a restart loses, and the decision for each

Verified against `src/Pulse.WebApi/Features/EngineRuntime`, `src/Pulse.Core/Features/{Autonomy,Ambient,Generation}`
and `Features/Ops/EngineContentSeed`.

| # | Store (in-memory today) | What a restart loses | Decision | Safety rationale |
|---|---|---|---|---|
| 1 | `GenerationProviderCutRegistry` (`ConcurrentDictionary<Guid,byte>`) | A cut-to-Fake reverts to **live** | **Persist, restore exactly, automatically** | Lowering state. Losing it is the fail-open above. |
| 2 | `EngineAutonomyState._safetyClamp`, `_stopped` (kill switch `DropToSuggest` / `FullStop`) in `EngineAutonomyRegistry` | Clamp and stop clear; the exercise is un-stopped | **Persist, restore exactly, automatically** | Lowering state. Only a human `RestoreFromSafety` may clear it; a restart is not a human. |
| 3 | `EngineAutonomyState._degradedReason` plus the clamp the degrade imposed | Degraded alert clears | **Persist the clamp and reason, restore automatically** | Lowering. The circuit breaker itself is process state and starts closed; it re-trips on the next failure. The reason is restored so the banner and the restore-needs-a-human rule stay truthful. Recovery still never raises (`MarkProviderRecovered`). |
| 4 | `EngineAutonomyState._default` (exercise default) and `_overrides` (per-storyline) | Back to Suggest | **Persist; restore only the Suggest-equivalent. A DelayedAuto default or override is persisted as "previous", boot at Suggest** | A raise. See Q1. Boot value is the floor, which is also what a fresh exercise starts at. |
| 5 | `EngineAutonomyState._swampedMode` | Off | **Persist as "previous"; boot Off** | A raise (auto-send under swamped load). Lead-gated toggle (#36); must not return without a human. |
| 6 | `EngineAmbientPolicyRegistry` (`Slot` with `AmbientTierPolicy`: mode, caps, topic and persona allow-lists) | Policy resets to Off | **Persist the full policy; boot restores `Off` and `Review`, boots `Autonomous` as `Off`** (previous kept for restore) | `Review` only produces drafts for a human. `Autonomous` posts without a human and is gated by `AmbientAutonomyAuthorized` plus the A1c lead gate. Never auto-restored. Q1. |
| 7 | `EngineTierPolicyRegistry` (`TierPolicyMode`: Auto / Standard / Ambient) | Back to `Auto` | **Persist and restore exactly** | A cost and model-selection choice, not an egress raise. Losing it silently changes spend and the model mid-exercise. Q5 confirms. |
| 8 | `ReactionLoopRegistry` / `ReactionLoopRegistration` | Registry empty; the loop stops; a manual re-seed is required | **Persist the registration inputs; re-derive the object at startup** | See "What is persisted vs re-derived" below. Auto-reload is the runbook-step removal. Gated on #2 and #1 being loaded first. |
| 9 | `Storyline` mutable runtime state (`Phase`, `Intensity`, `Sentiment`, `TargetIntensity`, `MinutesSinceLastOfficialResponse`, `PhaseEnteredScenarioMinute`, `LastTickScenarioMinute`, `LastEngineReactionScenarioMinute`, `CurveName`) | Arc restarts at Dormant, minute 0 | **Persist a snapshot per storyline** | Not an egress control. Without it the auto-reload would replay a fresh arc mid-exercise, which is worse than the manual re-seed it replaces. Storyline id is stable (`Storyline.Create(id:)`). |
| 10 | `ReactionLoopRegistration.ResponseMatching` (`ResponseMatchTrustCurve`, auto-confirm) | Off | **Persist the opt-in flag as "previous"; boot Off** | A human-granted trust opt-in the engine may never enable itself (§8.2). Q1. |
| 11 | `ReactionLoopRegistration.PendingSlows` | Cleared | **Intentionally reset** | Miss-safe by design; a re-seed already clears it (06). Recomputed as new official posts arrive. |
| 12 | `ReactionLoopDriver._tickStates` (per-minute post counters, `WorkloadDemandMeter`) | Counters reset | **Intentionally reset** | Per-scenario-minute windows; a restart opens a fresh minute. Demand meter is a demand measure, not control state. |
| 13 | `ReactionLoopDriver._ambientWindows` (ambient per-minute and per-hour posting windows) | Hourly count resets | **Intentionally reset, disclosed** | A restart can allow up to one extra `MaxPerHour` window of ambient drafts. The cap is review-gated and small. Restarts are rare and operator-visible. Q4 if Tom wants it persisted. |
| 14 | `AddressingInbox` (`ConcurrentQueue` of pending official posts) | Pending posts lost | **Intentionally reset** | Drain is at-most-once by design (06); posts made during downtime would resolve against the wrong moment. Re-derivation from the `Posts` table is a possible later improvement. |
| 15 | `EngineReviewService` internal dictionaries (countdown and draft state) | n/a | **Already durable** | Review items, dispositions and countdowns are in `EngineReviewItems` (02). After restart an expired countdown auto-HOLDs (never sends), because swamped mode boots Off. |
| 16 | `PauseTierRegistry`, `ExerciseClockService`, `OverlayStateService` | n/a | **Already durable** | `demo-feedback/18`. This story reuses its rehydrator ordering, not its table. |
| 17 | Provider circuit breaker (`AddEngineGeneration`) | Closed | **Intentionally reset** | Process-health state. Re-trips on the next failure and fans out a degrade to every loaded exercise. This is why the autonomy states must be loaded before the first provider call (see the load-order AC). |

### What is persisted vs re-derived (row 8)

`ReactionLoopRegistration` is a graph of live objects. We do **not** serialize the graph. We persist the *seed
inputs* and rebuild the graph from durable sources the same way `EngineContentSeedService.SeedAsync` does:

- persisted: `StorylineId`, `ResponseWindowMinutes`, `ScenarioStart`, `ControllerDeskId`, `RateConfig`,
  `AutoConfirmResponses` (previous), `SeededAtUtc`, `SeededBy`, the `StorylineParticipants` handle list;
- re-derived at startup: `ExerciseBrief` (constant), `AmbientPlaceName` and `TimeZone` (the `Exercise` row),
  `PersonasByHandle` (the exercise's castable `Persona` rows, so a persona closed since the seed is dropped),
  the storyline definition (`Storyline.Create` with the persisted id, then the row-9 snapshot applied),
  `Autonomy` (the shared `EngineAutonomyRegistry` instance, never a detached one: the `engine-content-seed` AC3
  correctness point).

## Gates (read before starting)

1. **Schema gate (C1 rule 1 and C5: one migration per wave).** This story adds exactly **one** migration. It does not
   start until Session A's **A1 foundation migration is on `main`**, this branch has merged `main`, and the
   orchestrator has **cleared the migration slot** for Session C. Until then only the non-schema parts (the
   `Restore` seams on `EngineAutonomyState`, tests against a fake store) may be drafted. Tom signs off schema,
   isolation and security changes (C5).
2. **Provider is not flipped before PROVIDER-GOVERNANCE section 8 is signed** (it was signed 2026-10-16). This story
   does not change that; it only guarantees the lever holds across a restart.
3. **#571 / #607 (ambient policy) and the A1c lead gate.** `EngineAmbientPolicyRegistry.TrySet` (compare-and-set on a
   reference-compared `Slot`), `Set` and `DemoteAutonomous` are mutually atomic today and the A1c lead gate calls
   `AmbientPolicyRaise.IsRaise` inside the `TrySet` retry loop. This story must not weaken either (see the CAS and revision ACs).
   A1c is not on `main` at the time of writing; the "restore previous" action is wired to the same
   `LeadControllerRaiseFilter` once it lands, and is **controller-only** meanwhile (marked `// TODO(A1c)`).

## Acceptance Criteria

### Persist (write-through)

- [ ] **One schema, exercise-scoped.** Given the migration, then each new entity (`EngineControlState`,
      `EngineLoopRegistration`, `EngineStorylineState`; see `implementation.md`) implements `IExerciseScoped`, is
      behind the `PulseDbContext` central query filter, has a non-empty `ExerciseId` write guard, and a
      `Restrict` FK to `Exercises` (XC-010: exercises are never hard-deleted).
- [ ] **Lowering controls write through before they are reported done.** Given a controller engages the kill switch
      (either mode) or cuts the provider to Fake, then the in-memory state applies first (fail closed), the row is
      written (awaited, outside the registry lock, with the `TransientSqlErrors` retry from story 18), and the
      response carries `persisted: true|false`. A failed write is logged at Error, **never** rolls the clamp or cut
      back, and the response says `persisted: false` so the controller knows a restart would lose it.
- [ ] **Every other control writes through** after its in-memory apply: exercise default, storyline override,
      swamped mode, tier policy, ambient policy (after a successful `TrySet`, `Set` or `DemoteAutonomous`), the
      degraded clamp and reason, the loop registration (on seed, re-seed and remove), and each storyline snapshot at
      the end of a tick that changed it (not every tick).
- [ ] **No stale write can regress a lowering.** Given two writes to the same control race (for example a late
      "ambient Autonomous" write behind a "demote to Off"), then the later in-memory revision wins. Each control
      carries a monotonic revision (taken from the in-memory CAS slot) and the SQL write is conditional on
      `StoredRevision < newRevision`, so an out-of-order async write is dropped, never applied.

### Restore (startup)

- [ ] **Lowering state is restored exactly and before anything can generate.** Given exercise A was killed
      (`FullStop`), cut to Fake and degraded, when the host restarts, then A's `EngineAutonomyState` has
      `IsGenerationStopped == true`, the same clamp and degraded reason, and `IsCutToFake(A)` is true,
      **before** the first hosted service tick and before the first HTTP request is served. No manual step.
- [ ] **Raises are not auto-restored.** Given A had a `DelayedAuto` default, a storyline override, swamped mode ON,
      ambient `Autonomous` and auto-confirm on, when the host restarts, then A boots at `Suggest`, swamped OFF, ambient
      `Off` (a `Review` ambient policy is restored as it was), auto-confirm off; the "previous" values stay in the
      row, and a human restore re-applies them (next AC). *(Decided: Q1.)*
- [ ] **A human can restore the previous raises in one step, logged.** Given A booted with "previous" raises on
      file, then the controller cockpit shows a staff banner naming each (COBRA, severity not colour-only, text plus
      icon, NFR-001), and a controller-confirmed "Restore previous settings" re-applies them through the **same**
      code paths as a manual raise (so the ambient `TrySet`/`IsRaise` check, the `AmbientAutonomyAuthorized` flag and,
      once landed, the A1c lead gate all run). Each applied raise emits its normal audit event with the human actor.
- [ ] **Fail closed on a bad or unreadable row.** Given a control row fails to parse, or the table is unreadable
      after the transient-retry budget, then the exercise boots with the **most restrictive** reading of what could
      not be read: the engine is treated as `FullStop`-clamped and cut to Fake, startup does not fail, an Error is
      logged naming the exercise, and the cockpit banner says the state could not be restored. A row for an exercise
      that no longer exists is logged and skipped.
- [ ] **The loop comes back with no re-seed.** Given a persisted registration for A, when the host restarts, then
      `IReactionLoopRegistry.Active` contains A's rebuilt registration (same storyline id, cast re-derived from
      castable personas, storyline arc as snapshotted, autonomy from the shared `EngineAutonomyRegistry`), and the
      next `ReactionLoopHost` tick runs without a call to `POST /api/ops/seed-engine-content`. The restored clock is
      not restarted (story 18 `ShouldStartClock`).
- [ ] **Re-seed still works and still overwrites.** Given an explicit re-seed, then it replaces the registration row
      and resets that exercise's storyline snapshot to `Dormant`, but it does **not** clear the kill switch, the
      clamp, the stop or the cut (a re-seed is not a human restore). *(Today a re-seed builds a fresh state; this is
      an intentional change. Decided: Q3.)*

### Ordering and concurrency

- [ ] **Load order is a hard contract.** Given the host starts, then the hosted service
      `EngineRuntimeStateRehydrator` runs `StartAsync` in this order: (1) after `ExerciseRuntimeStateRehydrator`
      (story 18, so the restored clock exists), (2) autonomy states and the cut set loaded into
      `EngineAutonomyRegistry` and `GenerationProviderCutRegistry` for **every** persisted exercise (so the
      provider-health fan-out in `EngineAutonomyProviderHealthListener.ActiveExercises` sees them), (3) tier and
      ambient policy, (4) loop registrations and storyline snapshots, (5) only then may `ReactionLoopHost`,
      `EngineReviewTickHost` and the noise/ambient hosts tick. A test asserts the order against the registered
      hosted-service list.
- [ ] **CAS semantics are unchanged.** Given the ambient registry loads a persisted policy, then it is installed as a
      fresh `Slot` through the registry's own seam (no direct dictionary access), `Get` returns an instance that
      `TrySet(expected: thatInstance, …)` accepts, and the #571/#607 mutual-atomicity tests
      (`TrySet` vs `Set` vs `DemoteAutonomous`) still pass unmodified. Persistence is layered **behind** the CAS, not
      in front of it: the in-memory slot stays the authority, the row is a follower.
- [ ] **A kill switch or cut that races the load is not lost.** Given a controller engages the kill switch while the
      rehydrator is still loading A, then the result is the clamped state (a lowering is never discarded by a load
      that read an older row), proved by the revision guard.

### Cross-cutting

- [ ] **Isolation (XC-001/COR-001).** Restoring, writing or restoring-previous for exercise A never reads or changes
      B (two-exercise test at the store, the rehydrator and over HTTP); a foreign-exercise and a foreign-org attempt on
      the new "restore previous" route return 403/404 and extend the standing isolation suite. The rehydrator's single
      cross-exercise read uses the documented `IgnoreQueryFilters` reader and is read-only (story 18 pattern); every
      write goes through the scoped path.
- [ ] **Telemetry (XC-004).** The restore emits one `engine.state_restored` event per exercise at startup
      (restored lowering state, "previous raises held back", rows skipped) and "restore previous" emits the raise's
      normal event plus the human actor; wall time plus scenario time, channel `system`, against the v0 envelope
      (added through the engine event-type extension, not a fork).
- [ ] **LLM governance (NFR-005, ADP-024).** The restored cut-to-Fake and kill switch are checked on the **same**
      egress decision points as live ones (`GenerationProviderSelector`, `ResolveEffective`); a test proves a restored
      cut prevents any call to the configured provider, and persisted storyline or persona text is still passed as
      untrusted data in prompts (no persisted field becomes an instruction).
- [ ] **Soft-delete / retention (XC-010).** Engine control rows are machine state, not in-fiction content or AAR
      evidence; hard-delete on exercise reset is documented as deliberate (as story 18 L-2). Audit of every control
      change stays in `TelemetryEvents`, which is retained.
- [ ] **Accessibility (NFR-001) and staff world.** The one new banner uses the COBRA components and
      `@/theme/styledComponents`, FontAwesome only, state conveyed by text plus icon, `role="status"` live region;
      nothing participant-visible changes (no enterprise look to guard, no participant skin touched).
- [ ] **User guide.** The controller guide's restart / go-live page drops the manual re-seed step and describes the
      restore banner (and re-captures the screenshot if the cockpit banner is documented).

## Out of Scope

- Making the circuit-breaker state, the `AddressingInbox` or the rate windows durable (rows 12 to 14, 17 are
  intentionally reset).
- Multi-instance coordination. UAT and prod are one App Service instance; the rows are last-writer-wins by
  revision, and a second instance is a separate story.
- Auto mode (v1.1), new autonomy levels, rumor model, storyline auto-detection and authoring endpoints (a
  `DbSet<Storyline>` with a full authoring path is still the `storyline-model` follow-up; this story persists only
  the runtime snapshot of the one seeded storyline set).
- Changing the pause tier / clock / overlay persistence (story 18) or the kill-switch semantics themselves.
- Per-customer provider selection, Foundry/Claude, infra changes.
- A participant-facing change of any kind.
- Any change to who may raise (the A1c lead gate is Session A's); this story only routes the restore through it.

## Decisions (Tom, 2026-10-17: "Accept all proposals")

All eight proposals below are **accepted as written** and are now requirements of this story:

| # | Decision |
|---|---|
| Q1 | Raises do **not** auto-restore. Lowering state (kill switch, FullStop, degraded clamp, cut-to-Fake) is restored exactly and automatically. Raising state (Delayed-auto default and overrides, swamped mode ON, ambient `Autonomous`, response auto-confirm) is persisted as "previous" and the exercise boots at the floor, with a controller-confirmed one-click restore. |
| Q2 | "Restore previous settings" is open to a controller on the exercise until A1c lands, then **lead controller only**. |
| Q3 | A re-seed **never** clears a kill switch or cut; only `RestoreFromSafety` and the provider "restore to live" do. This changes today's re-seed behaviour on purpose. |
| Q4 | The ambient posting windows are **not** persisted. At most one extra `MaxPerHour` window after a restart is accepted (review-gated, small). |
| Q5 | The tier policy restores **automatically** (cost and model choice, not a raise). |
| Q6 | Storyline progress is snapshotted at the end of any tick that changed intensity, phase or last-response. Losing at most the last changed tick on a hard crash is accepted. |
| Q7 | If the rows cannot be read at startup, that exercise boots **FullStop and cut to Fake**, with an Error log and a banner, until a human restores it. |
| Q8 | The runbook lives on #571 (`UAT-GOLIVE-RUNBOOK.md`); the build PR removes its manual re-seed step once this ships. |

The build remains **post-demo**, and the migration remains gated on A1 on `main` plus the orchestrator's clearance.

## Open questions for Tom (answered above; kept for the record)

Q1. **Do raises auto-restore after a restart?** Proposal: no. Lowering state (kill switch, FullStop, degraded
clamp, cut-to-Fake) is restored exactly and automatically. Raising state (Delayed-auto default or override,
swamped mode ON, ambient `Autonomous`, response auto-confirm) is persisted as "previous" but the exercise boots at
the floor, with a controller-confirmed one-click restore. Cost: a controller must re-apply after every deploy during
play. Alternative: restore everything automatically except `Autonomous` ambient and swamped mode. Which?

Q2. **Who may press "Restore previous settings"?** Proposal: a controller on the exercise, and once A1c lands, the
lead controller only, because it re-applies raises. OK, or lead-only from day one?

Q3. **Should an explicit re-seed clear the kill switch / cut?** Proposal: no. A re-seed resets the loop and the
arc but never clears a lowering; only `RestoreFromSafety` and "restore to live" clear it. This changes today's
behaviour (a re-seed builds a fresh `EngineAutonomyState`). Confirm?

Q4. **Persist the ambient posting windows?** Proposal: no, accept one extra `MaxPerHour` window after a restart
(review-gated, small). Say if the hourly cap must hold across restarts.

Q5. **Is the tier policy (Auto / Standard / Ambient) a "restore automatically" control?** Proposal: yes (cost and
model selection, not a raise). The alternative treats `Standard` as a raise because it is the more expensive model.

Q6. **Storyline progress cadence.** Proposal: snapshot at the end of any tick that changed intensity, phase or
last-response, not on a timer. Is losing at most the last changed tick acceptable on a hard crash?

Q7. **Failure posture when the rows cannot be read at startup** (database still waking, 40613 retries exhausted).
Proposal: engine treated as `FullStop` and cut to Fake for any exercise we cannot read, with an Error log and a
banner, until a human restores. Alternative: start with nothing loaded and the loop off (no registrations, so no
generation), which is also safe for loop traffic but leaves the direct re-roll path on the live provider.

Q8. **`UAT-GOLIVE-RUNBOOK`** is referenced in the brief but is not on `main` in this checkout. Which branch holds it,
so the re-seed step can be removed in the same PR?

## Technical Notes

Staff/backend. Reuse the story-18 pattern end to end: scoped `DbContext` through `IServiceScopeFactory` from
singletons, awaited write-through outside the registry lock, `TransientSqlErrors` retry, a single read-only
`IgnoreQueryFilters` rehydrator, `FakeTimeProvider` for wall time across a simulated restart. Entities, migration,
ordering, write-through points and tests are in `implementation.md` section "Story 07". Touches `Pulse.Core`
(`EngineAutonomyState` gains an internal `Restore(...)` factory that can only restore a **more restrictive or equal**
state than it is handed; the Core engine otherwise unchanged, per BACKEND_ROADMAP §8 Risk 4) and `Program.cs`
(one additive line in the orchestrator's wiring commit, C1 rule 2).

## Dependencies

- **Hard gate:** Session A's A1 foundation migration on `main` and the migration slot cleared by the orchestrator
  (Gate 1).
- `demo-feedback/18` (rehydrator, store pattern, retry) is in `main`.
- `engine-runtime/01`, `02`, `05`, `06`, `engine-content-seed/02`, `ambient-chatter/01` (all built).
- **Soft:** A1c (lead gate) for Q2; this story ships controller-only restore with the TODO marker if A1c is not yet on `main`.

## Tests

Under `src/Pulse.WebApi.Tests/Features/EngineRuntime/Persistence/` (Docker-gated SQL tests are `[RequiresDockerFact]`).
Full list and names in `implementation.md`; headline checks:

- **Restart survival with a real host restart (Docker-gated):** build the test host over a real SQL container, kill
  switch + cut + degrade + seed, dispose the host, build a **new** host over the same database, assert the Restore ACs
  outcomes, and that `GenerationProviderSelector` returns the Fake provider and no call reaches the live fake endpoint.
- **Fail closed:** unparseable row, unreadable table, a race with the load, a write that fails (state still clamped).
- **Isolation:** two exercises at store, rehydrator and HTTP; foreign-org 403/404 on the restore route.
- **CAS regression:** the existing #571/#607 ambient registry tests pass unmodified; plus a persisted-policy `TrySet` test.
- **Load order:** the hosted-service order test.
