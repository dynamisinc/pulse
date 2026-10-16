namespace Pulse.WebApi.Features.EngineRuntime;

using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The narrow seam through which identity-auth-roles/16 turns an exercise's swamped mode OFF when the exercise loses
/// its lead controller (Tom, 2026-10-16, Option A: removing the lead's enrollment or moving it off <c>controller</c>
/// clears the lead and turns swamped mode off; the exercise then has no lead until a planner sets one).
/// </summary>
/// <remarks>
/// Deliberately OFF-only: this seam can never raise autonomy (E8 §8.2 — automation never self-escalates), and it
/// does not gate anything — the lead gate on the swamped-mode/autonomy routes is story 17. It writes the SAME
/// <see cref="EngineAutonomyRegistry"/> singleton the cockpit's <c>POST /api/engine/autonomy/swamped-mode</c> toggles
/// (through <see cref="EngineReviewService.SetSwampedModeAsync"/>), via the same
/// <c>EngineAutonomyState.SetSwampedMode</c> call, so the cockpit and the reaction loop see the change at once.
/// </remarks>
public interface ISwampedModeSwitch
{
    /// <summary>Turns swamped mode OFF for <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The exercise (a real, server-resolved id).</param>
    /// <param name="actingHumanId">The human whose action caused it (COR-018).</param>
    /// <returns>Whether swamped mode was ON before the call.</returns>
    bool TurnOff(Guid exerciseId, string actingHumanId);

    /// <summary>
    /// Whether swamped mode is currently on for <paramref name="exerciseId"/> — read without changing anything, so the
    /// caller can audit the state BEFORE its unit of work commits and flip it only AFTER (identity-auth-roles/16 M-002).
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns><c>true</c> when swamped mode is on.</returns>
    bool IsOn(Guid exerciseId);
}

/// <summary>The production <see cref="ISwampedModeSwitch"/> over the shared <see cref="EngineAutonomyRegistry"/>.</summary>
public sealed class EngineSwampedModeSwitch : ISwampedModeSwitch
{
    private readonly EngineAutonomyRegistry _autonomy;
    private readonly IExerciseClock? _clock;

    /// <summary>Creates the switch.</summary>
    /// <param name="autonomy">The shared per-exercise autonomy registry (singleton).</param>
    /// <param name="clock">The exercise clock for the change's scenario minute; minute 0 when no clock is registered.</param>
    public EngineSwampedModeSwitch(EngineAutonomyRegistry autonomy, IExerciseClock? clock = null)
    {
        ArgumentNullException.ThrowIfNull(autonomy);
        _autonomy = autonomy;
        _clock = clock;
    }

    /// <inheritdoc />
    /// <inheritdoc />
    public bool IsOn(Guid exerciseId) => _autonomy.GetOrCreate(exerciseId).SwampedModeEnabled;

    /// <inheritdoc />
    public bool TurnOff(Guid exerciseId, string actingHumanId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actingHumanId);

        var state = _autonomy.GetOrCreate(exerciseId);
        var wasOn = state.SwampedModeEnabled;
        state.SetSwampedMode(false, actingHumanId, _clock?.CurrentScenarioMinute(exerciseId) ?? 0);
        return wasOn;
    }
}
