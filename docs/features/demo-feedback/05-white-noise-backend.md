# Story: White-noise pool and pacer

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** ambient chatter (lite, non-AI slice of #168)  ·  **Decisions:** DF-12, DF-13  ·  **Issue:** #501
**Stack:** backend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

"White noise is great. Other systems generate it themselves; the exercise team doesn't curate it." And from the other
notes: a **volume knob** on posts. Live AI is out of this demo, so white noise is a pre-written pool of everyday posts
that a server pacer releases at the rate a controller sets: Off, Low, Medium or High. The knob UI is story 09; the pool
content is C3 and the seed script loads it (S1). Shapes are frozen in [`implementation.md`](implementation.md#types).

## Acceptance Criteria

- [ ] `GET /api/staff/noise` (any assigned staff, including evaluators) returns `NoiseStateDto` for the exercise.
- [ ] `PUT /api/staff/noise { level }` (controller role) persists `Exercise.NoiseLevel`, returns the new
      `NoiseStateDto`, and pushes `NoiseStateChanged` to the **staff group** (`StaffGroupNameFor`). An unknown level ⇒
      400. Setting the current level again is a no-op `200` with no push and no telemetry.
- [ ] `PUT /api/staff/noise/pool { mode, posts }` (controller role) replaces or appends the pool. Each entry's
      `persona` resolves by handle (leading `@` stripped) or id **in this exercise**; text goes through `PostSanitizer`
      and must be 1–280 **code points** (as `InjectItemValidator` counts them, not `string.Length`). Bad entries are reported in `rejected` with their index and reason, the rest apply,
      all in one `SaveChanges`. More than 1,000 entries ⇒ 400. `replace` resets `PostedCount` for the new pool.
- [ ] **Pacer (DF-12):** a hosted service publishes noise posts for every exercise whose level is not `off`, at
      0 / 2 / 6 / 15 posts per minute with ±40% jitter on each gap. Each post goes through `PostIngestService.IngestAsync`
      with `Origin = "noise"`, the pool item's persona, no acting human, and the current **scenario time**, so it reaches
      feeds through the normal `PostReceived` push. The picked item's `PostedCount` and `LastPostedWallClock` update in
      the same unit of work.
- [ ] **Selection (DF-13):** least-posted first, then pool order; never the same persona twice in a row when another
      persona is available; an empty pool means nothing posts and `running` is false.
- [ ] **Stops (DF-13):** no noise while the pause tier is `Freeze`, the exercise clock is frozen or not running, or the lifecycle is not `staged`/`live` (EndEx, lifecycle pause);
      `Pause injects` and `Engine paused` do **not** stop noise. Noise resumes on the next tick after the stop clears.
- [ ] **Restart:** after an API restart the pacer resumes at the persisted level (no catch-up burst for the downtime).
- [ ] `NoiseStateChanged` is also pushed after each published noise post (so `postedCount`/`lastPostedAt` stay live),
      throttled to at most one push per 2 seconds per exercise.
- [ ] Noise posts **never** appear in the run sheet (`GET /api/injects`) and are not inject items.

### Cross-cutting
- [ ] **Isolation (XC-001):** the pacer sets `ExerciseContext.CurrentExerciseId` per exercise in a fresh scope (as
      `InjectBurstRunner` does); a pool entry or post never crosses exercises (test with two exercises at different levels).
- [ ] **Two worlds (XC-002):** noise state and pool are staff-only; participants see only the posts.
- [ ] **Telemetry (XC-004):** `noise.level.changed {from, to}`, `noise.pool.replaced {poolSize}` (counts only).
- [ ] **Burst legibility (NFR-002):** High (15/min) stays far below 120/min.

## Out of Scope

The console knob (09). AI-generated chatter (#168). Per-persona or per-topic weights. Media in noise posts. A pool
editor UI (the seed script loads the pool).

## Tests

Use a fake clock / time provider: level persistence and push, pool replace/append/reject, rate per level within
jitter bounds over a simulated window, selection rules, Freeze/clock stops, Pause injects does not stop, restart
resume, isolation across two exercises, role gates (evaluator GET ok, PUT 403), throttle, telemetry.

## Tech notes

Own new `Features/WhiteNoise/**` (`WhiteNoiseEndpoints.cs` with `AddWhiteNoise()` / `MapWhiteNoise()`,
`WhiteNoiseService.cs`, `WhiteNoisePacer.cs : BackgroundService`, `NoiseRates.cs`, `NoiseBroadcaster.cs`). Model the
tick on `InjectBurstRunner` (fresh scope per exercise, pause-tier check via `PauseTierRegistry.GetTier`, clock via
`IExerciseClock`). `AddWhiteNoise()` registers after `AddInjects`/`AddPauseTierSteering` (seam S-2).
