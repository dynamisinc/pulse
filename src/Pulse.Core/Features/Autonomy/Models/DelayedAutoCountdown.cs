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
public sealed record DelayedAutoCountdown
{
    /// <summary>
    /// Creates a countdown snapshot, validating its fields up front so an invalid countdown can never
    /// exist: the ids are non-empty (COR-001 exercise scope), and the start/length are non-negative — a
    /// negative length would otherwise "expire" immediately and mis-drive <see cref="AutoHoldPolicy"/>.
    /// </summary>
    public DelayedAutoCountdown(
        Guid exerciseId,
        Guid storylineId,
        Guid draftId,
        int startedScenarioMinute,
        int countdownMinutes,
        ControllerDecision decision = ControllerDecision.None)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A countdown must belong to an exercise (COR-001).", nameof(exerciseId));
        }

        if (storylineId == Guid.Empty)
        {
            throw new ArgumentException("A countdown must name its storyline.", nameof(storylineId));
        }

        if (draftId == Guid.Empty)
        {
            throw new ArgumentException("A countdown must name its draft.", nameof(draftId));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(startedScenarioMinute);
        ArgumentOutOfRangeException.ThrowIfNegative(countdownMinutes);

        ExerciseId = exerciseId;
        StorylineId = storylineId;
        DraftId = draftId;
        StartedScenarioMinute = startedScenarioMinute;
        CountdownMinutes = countdownMinutes;
        Decision = decision;
    }

    /// <summary>The exercise the draft belongs to (COR-001).</summary>
    public Guid ExerciseId { get; init; }

    /// <summary>The storyline the draft voices.</summary>
    public Guid StorylineId { get; init; }

    /// <summary>Stable identity of the draft/burst under countdown.</summary>
    public Guid DraftId { get; init; }

    /// <summary>The scenario minute the countdown began.</summary>
    public int StartedScenarioMinute { get; init; }

    /// <summary>The countdown length in scenario minutes (non-negative).</summary>
    public int CountdownMinutes { get; init; }

    /// <summary>The controller's decision so far (default <see cref="ControllerDecision.None"/>).</summary>
    public ControllerDecision Decision { get; init; }

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
