namespace Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The native per-exercise scenario clock (COR-050) that drives the engine's scenario-time timers — the
/// reaction-loop host (story 01) and the Delayed-auto countdown (story 02) advance off this one clock. It is
/// the <b>swappable</b> seam: the native <see cref="ExerciseClockService"/> is the v1 provider, and a
/// Cadence-linked provider is a Phase-4 swap behind this same interface with <b>no</b> engine change
/// (mirroring the config/DI provider selection of <c>AddEngineGeneration</c>). The engine itself never reads
/// this interface directly — it reads only <see cref="Pulse.Core.Features.Storylines.Services.IScenarioClock"/>,
/// which <see cref="ScenarioClockAdapter"/> exposes over this clock (adapting the engine seam, not changing it).
///
/// <para><b>Scenario time only (COR-053).</b> Every value here is scenario time in the exercise's time zone,
/// never wall-clock: a <see cref="Freeze"/> holds <see cref="CurrentScenarioMinute"/> constant (silence
/// windows and countdowns do not accrue) and a <see cref="Jump"/> leaps it forward in one discrete step. Wall
/// time drives the clock underneath, but never an engine timer directly — the timer reads a scenario minute
/// that a freeze halts and a jump advances.</para>
///
/// <para><b>Isolation (COR-001).</b> The clock is per-exercise: freezing or jumping exercise A never moves
/// exercise B's scenario minute. State is keyed by <c>exerciseId</c>; there is no shared clock.</para>
/// </summary>
public interface IExerciseClock
{
    /// <summary>
    /// Begins (or restarts) exercise <paramref name="exerciseId"/>'s clock at
    /// <paramref name="scenarioStart"/> — the scenario start instant — expressed in
    /// <paramref name="timeZone"/> (the exercise time zone, COR-030). After this,
    /// <see cref="CurrentScenarioMinute"/> starts at 0 and advances monotonically as scenario time elapses.
    /// </summary>
    /// <param name="exerciseId">The exercise whose clock is starting (COR-001); must not be empty.</param>
    /// <param name="scenarioStart">The scenario start instant the clock reads as scenario minute 0.</param>
    /// <param name="timeZone">The exercise time zone the scenario instant is expressed in.</param>
    void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone);

    /// <summary>
    /// Freezes exercise <paramref name="exerciseId"/>'s scenario time (COR-052 / CTL-023): scenario time holds
    /// constant so silence windows and Delayed-auto countdowns do not accrue while frozen. Freezing an
    /// already-frozen clock is a no-op. On <see cref="Unfreeze"/> the clock resumes exactly where it stopped.
    /// </summary>
    /// <param name="exerciseId">The exercise to freeze; must have been started.</param>
    void Freeze(Guid exerciseId);

    /// <summary>
    /// Resumes exercise <paramref name="exerciseId"/>'s scenario time from exactly where <see cref="Freeze"/>
    /// stopped it (a window with 4 minutes left still has 4 minutes left). Unfreezing a running clock is a
    /// no-op.
    /// </summary>
    /// <param name="exerciseId">The exercise to resume; must have been started.</param>
    void Unfreeze(Guid exerciseId);

    /// <summary>
    /// Advances exercise <paramref name="exerciseId"/>'s scenario time by <paramref name="scenarioMinutes"/>
    /// in one discrete step (COR-051 / CTL-015): <see cref="CurrentScenarioMinute"/> leaps by exactly N. Any
    /// storyline window or Delayed-auto countdown the skip carries past its deadline is left expired for the
    /// engine's next tick to dispose (a countdown carried past its deadline resolves to a HOLD via
    /// <c>AutoHoldPolicy</c>, never a missed auto-send). A jump applies whether the clock is running or frozen
    /// and does not resume a frozen clock.
    /// </summary>
    /// <param name="exerciseId">The exercise to jump; must have been started.</param>
    /// <param name="scenarioMinutes">The number of scenario minutes to advance; must be non-negative.</param>
    void Jump(Guid exerciseId, int scenarioMinutes);

    /// <summary>
    /// Scenario minutes elapsed since exercise <paramref name="exerciseId"/> started — monotonic under normal
    /// running, held constant while frozen, leaping on a jump. Reading an exercise whose clock has not been
    /// started returns 0 (scenario minute 0 = not yet started), never another exercise's minute.
    /// </summary>
    /// <param name="exerciseId">The exercise whose scenario minute to read.</param>
    int CurrentScenarioMinute(Guid exerciseId);

    /// <summary>
    /// The current scenario instant for exercise <paramref name="exerciseId"/>, expressed in the exercise time
    /// zone: the scenario start plus the elapsed scenario time. Returns <c>null</c> if the clock has not been
    /// started.
    /// </summary>
    /// <param name="exerciseId">The exercise whose scenario instant to read.</param>
    DateTimeOffset? CurrentScenarioTime(Guid exerciseId);

    /// <summary>Whether exercise <paramref name="exerciseId"/>'s clock is currently frozen (COR-052).</summary>
    /// <param name="exerciseId">The exercise to inspect.</param>
    bool IsFrozen(Guid exerciseId);

    /// <summary>Whether exercise <paramref name="exerciseId"/>'s clock has been started and is not frozen.</summary>
    /// <param name="exerciseId">The exercise to inspect.</param>
    bool IsRunning(Guid exerciseId);
}
