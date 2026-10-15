# Story: Pause tier, exercise clock and holding page survive a restart

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-053, world-steering Freeze (#350/#351), #526 (restart resilience slice)  ·  **Decisions:** DF-24..DF-28  ·  **Issue:** #536
**Stack:** backend  ·  **World:** foundation  ·  **Review:** Tier-1 (+ Tom reads the reset route)  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** M
**Owner:** planning session · **Branch:** `build/demo-feedback/18-persist-tier-clock` → `feature/demo-feedback-w4`

## Context

`PauseTierRegistry` (`ConcurrentDictionary<Guid, PauseTier>`), `ExerciseClockService`
(`ConcurrentDictionary<Guid, ExerciseClockState>`) and `OverlayStateService` hold their state only in memory. A deploy
or restart puts every exercise back to Running with an unstarted clock (the next `ReactionLoopHost` tick restarts it
from the in-memory registration's `ScenarioStart`), and participants lose the holding page. On 10/15 that left UAT
**LIVE (suggest) with ~37 drafts**. Customer note (#526): *"Stability!"*. Tom 10/15: a running clock keeps advancing
through downtime; the tier comes back exactly as set.

## Acceptance Criteria

### Persist (write-through)

- [ ] New `Features/EngineRuntime/Persistence/IExerciseRuntimeStateStore` + EF implementation (scoped `DbContext`
      through `IServiceScopeFactory`, since the registry and clock are singletons). `UpsertAsync` writes the full row;
      `DeleteAsync` removes it.
- [ ] `PauseTierRegistry.SetTierAsync` writes the tier, clock and overlay snapshot **after** the in-memory apply and
      **outside** its lock, awaited. `Unchanged` and refused outcomes write nothing. A failed write is logged at Error
      and the response carries `persisted: false` (never rolls the tier back, never throws to the caller).
- [ ] `ExerciseClockService` `Start`, `Freeze`, `Unfreeze` and `Jump` persist the anchor: `ClockScenarioStart`,
      `ClockTimeZone` (IANA/Windows id as `TimeZoneInfo.Id`), `ClockElapsedAtAnchorTicks`, `ClockWallAnchorUtc` (from
      `TimeProvider.GetUtcNow()`, never `GetTimestamp()`), `ClockFrozen`. The clock API stays synchronous for its
      readers; persistence is a fire-and-observe write (queued, logged on failure), so `CurrentScenarioMinute` never
      waits on SQL.
- [ ] The overlay publisher persists `OverlayState`, `OverlayRegister`, `OverlayMessage` and `OverlaySequence` with
      each published snapshot.

### Restore (startup)

- [ ] New hosted service `ExerciseRuntimeStateRehydrator` runs in `StartAsync` **before any other hosted service
      ticks** (registered first by seam S-5): reads every row (cross-exercise reader, `WhiteNoisePacer` pattern) and
      restores each exercise:
      - tier exactly as persisted (DF-26);
      - clock: running ⇒ `elapsed = elapsedAtAnchor + (utcNow − wallAnchorUtc)`; frozen ⇒ `elapsedAtAnchor` (DF-25),
        through a new `IExerciseClock.Restore(...)` (or an internal equivalent) that does not count as `Start`;
      - overlay snapshot and sequence, with the next sequence = persisted + 1 (DF-27), so `GET /api/overlay-state`
        returns the holding page after a restart while frozen.
- [ ] A row for an exercise that no longer exists, or one that fails to parse, is logged and skipped; startup never
      fails because of runtime state.
- [ ] `ReactionLoopHost` does not restart a restored clock (`ShouldStartClock` already returns false for running or
      frozen; a test proves the restored scenario minute survives the first tick).
- [ ] A restored Freeze still blocks what Freeze blocks today: inject fire (`InjectQueueService.FrozenMessage`),
      noise (DF-13), engine ticks.

### Reset (DF-28)

- [ ] `POST /api/steering/runtime-state/reset` (controller only; staff + controller filters as `POST
      /api/steering/pause-tier`): sets tier Running, clears the clock (unstarted), publishes overlay `none` with the next
      sequence, deletes the row, emits `steering.runtime_reset`, returns `PauseTierStateDto`. Exercise-scoped: it never
      touches another exercise. Idempotent.
- [ ] `docs/features/world-steering/` notes and the `PauseTierRegistry` XML docs no longer say "an App Service
      restart clears the tiers".

### From the 10/15 reviews (story 17 Gate-1, PR #548 Copilot)

- [ ] `GET /api/steering/runtime-state/reset` answers **405** (the route is POST-only), with a test: story 27's
      `Test-FreezeResume.ps1` detects story 18 by that 405 (404 = pre-18).
- [ ] The reset's hard delete of the `ExerciseRuntimeStates` row is documented as deliberate: machine state, not
      in-fiction content or AAR evidence, so XC-010 retention does not apply (17 Gate-1 L-2).
- [ ] The rehydrator's cross-exercise read uses the single documented `IgnoreQueryFilters` reader and is read-only;
      all writes go through the scoped path (17 Gate-1 L-4). The all-null-or-all-set clock rule is enforced in code
      (17 Gate-1 L-3).

### Cross-cutting

- [ ] Isolation: restore and reset for exercise A never change B (test with two exercises).
- [ ] Telemetry: tier changes keep their existing events; the reset adds one.

## Out of Scope

Persisting engine loop registrations, storylines, autonomy level or the kill switch (`Reset-DemoState` still re-seeds
the loop). Multi-instance coordination (UAT is one B1 instance; the row is last-writer-wins). Frontend: none needed,
because the console already reads the tier from `GET /api/steering/pause-tier` after a restart; a warning chip for
`persisted: false` is a post-demo follow-up.

## Technical Notes

`Features/EngineRuntime/Clock/ExerciseClockService.cs` (`ExerciseClockState` :94: `_scenarioElapsedAtAnchor`,
`_wallAnchor` monotonic, `_frozen`); `Steering/PauseTierRegistry.cs` (`SetTierAsync` :234, `TryApplyClockEffect`
~:360, Freeze starts the clock with `PauseClockStart` at :390); `Steering/PauseOverlayPublisher.cs` (`OverlayStateService`
:114, `OverlayStateChanged` :103); `PauseTierEndpoints.cs` (:102-103). Use `FakeTimeProvider` in tests to move wall
time across a simulated restart (new service instances over the same database).

## Dependencies

17 (schema). Seam S-5 registers the rehydrator first and maps the reset route. 26 calls the reset route.

## Tests

`src/Pulse.WebApi.Tests/Features/EngineRuntime/Persistence/`: write-through per tier change (and none on Unchanged);
failed write ⇒ `persisted:false`, tier kept; simulated restart (new singletons, same DB, wall time +10 min) restores
Engine tier and a running clock 10 minutes later; Freeze restores frozen at the same minute and the overlay endpoint
returns the holding page with sequence > before; `ReactionLoopHost` first tick keeps the restored minute; bad row
skipped; reset clears and is exercise-scoped; `CompositionRootWiringTests` (rehydrator first, reset route once).
