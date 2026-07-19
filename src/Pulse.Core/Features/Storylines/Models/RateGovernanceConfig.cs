namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Per-exercise rate caps and quiet floors (ADP-011, E8 architecture §6.2). These keep the engine
/// between a firehose and a flatline: the <see cref="MaxEnginePostsPerMinute"/> ceiling means the engine
/// can't dump content, and the <see cref="MinBelievableActivity"/> floor means the world stays alive
/// during a lull (driving ambient chatter). Both a cost lever (§4.2) and a believability control.
/// Staff-only (XC-002), exercise-scoped (COR-001).
/// </summary>
public sealed record RateGovernanceConfig
{
    /// <summary>
    /// Creates a validated config. The floor may not exceed the cap (else the engine would be forced to
    /// firehose just to stay "believable").
    /// </summary>
    public RateGovernanceConfig(int maxEnginePostsPerMinute, int minBelievableActivity)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxEnginePostsPerMinute, 1);
        ArgumentOutOfRangeException.ThrowIfNegative(minBelievableActivity);

        if (minBelievableActivity > maxEnginePostsPerMinute)
        {
            throw new ArgumentException(
                $"minBelievableActivity ({minBelievableActivity}) cannot exceed maxEnginePostsPerMinute " +
                $"({maxEnginePostsPerMinute}) — the floor must not force a firehose.",
                nameof(minBelievableActivity));
        }

        MaxEnginePostsPerMinute = maxEnginePostsPerMinute;
        MinBelievableActivity = minBelievableActivity;
    }

    /// <summary>The hard ceiling on engine-generated posts per scenario minute (the engine can't firehose).</summary>
    public int MaxEnginePostsPerMinute { get; init; }

    /// <summary>The floor below which the world reads as dead, so ambient chatter tops it up.</summary>
    public int MinBelievableActivity { get; init; }

    /// <summary>
    /// Defaults sized against NFR-002 / §4.1: the cap matches the peak generated rate (~60/min) and the
    /// floor sits near the ambient-lull baseline (~a handful/min). Tunable per exercise.
    /// </summary>
    public static RateGovernanceConfig Default { get; } = new(maxEnginePostsPerMinute: 60, minBelievableActivity: 6);
}

/// <summary>
/// The outcome of a rate-cap check (ADP-011): how many posts were requested for a burst and how many the
/// cap allows this minute. The reaction loop enforces this at its publish stage — it throttles/queues the
/// overflow rather than firehosing.
/// </summary>
public sealed record CapDecision(int Requested, int Allowed)
{
    /// <summary>Posts that exceeded the cap and must be throttled/queued.</summary>
    public int Throttled => Requested - Allowed;

    /// <summary>Whether the cap trimmed the request.</summary>
    public bool WasThrottled => Throttled > 0;
}

/// <summary>
/// A live change to an exercise's rate governance (ADP-011) — logged as an XC-004 steering action. Not a
/// storyline event: caps/floors are exercise-scoped, so this carries <see cref="ExerciseId"/>, not a
/// storyline id. Staff-only (XC-002).
/// </summary>
public sealed record RateGovernanceChanged(
    Guid ExerciseId,
    RateGovernanceConfig From,
    RateGovernanceConfig To,
    int ScenarioMinute);
