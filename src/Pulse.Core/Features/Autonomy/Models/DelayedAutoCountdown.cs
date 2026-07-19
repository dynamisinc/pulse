namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>The controller's decision on a Delayed-auto draft while its countdown runs.</summary>
public enum ControllerDecision
{
    /// <summary>No decision yet — the countdown is the controller's window to act (or to let it hold).</summary>
    None,

    /// <summary>The controller approved the draft; it publishes regardless of the countdown.</summary>
    Approved,

    /// <summary>The controller vetoed the draft; it never publishes (holds/drops), regardless of the countdown.</summary>
    Vetoed,
}

/// <summary>
/// The scenario-time countdown state for a single Delayed-auto draft (E8 architecture §8.2). Immutable:
/// the loop advances a draft by recording a new snapshot (e.g. with a controller decision), so the
/// terminal decision is a pure function of the snapshot plus the current scenario minute — no hidden
/// timer state. Countdowns run in <b>scenario time</b> (COR-050/051): a freeze holds the deadline, a
/// time-jump can carry it past expiry (<see cref="AutoHoldPolicy"/> resolves that to a HOLD, never a
/// silent auto-send).
/// </summary>
/// <param name="ExerciseId">The exercise the draft belongs to (COR-001).</param>
/// <param name="StorylineId">The storyline the draft voices.</param>
/// <param name="DraftId">Stable identity of the draft/burst under countdown.</param>
/// <param name="StartedScenarioMinute">The scenario minute the countdown began.</param>
/// <param name="CountdownMinutes">The countdown length in scenario minutes (non-negative).</param>
/// <param name="Decision">The controller's decision so far (default <see cref="ControllerDecision.None"/>).</param>
public sealed record DelayedAutoCountdown(
    Guid ExerciseId,
    Guid StorylineId,
    Guid DraftId,
    int StartedScenarioMinute,
    int CountdownMinutes,
    ControllerDecision Decision = ControllerDecision.None)
{
    /// <summary>The scenario minute at which the countdown expires (start + length).</summary>
    public int DeadlineScenarioMinute => StartedScenarioMinute + CountdownMinutes;

    /// <summary>Whether the countdown has expired at <paramref name="currentScenarioMinute"/>.</summary>
    public bool HasExpired(int currentScenarioMinute) => currentScenarioMinute >= DeadlineScenarioMinute;

    /// <summary>
    /// Scenario minutes left before expiry at <paramref name="currentScenarioMinute"/> (0 once expired). The
    /// countdown/remaining state is surfaced by number, not colour alone (NFR-001).
    /// </summary>
    public int MinutesRemaining(int currentScenarioMinute) =>
        Math.Max(0, DeadlineScenarioMinute - currentScenarioMinute);

    /// <summary>Records the controller's decision, returning the updated snapshot.</summary>
    public DelayedAutoCountdown WithDecision(ControllerDecision decision) => this with { Decision = decision };
}
