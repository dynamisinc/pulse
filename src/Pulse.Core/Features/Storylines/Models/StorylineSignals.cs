namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Amplification input the intensity model bends up on (ADP-004 velocity + SOC-054 audience magnitude).
/// This is the seam the amplification-engine / E2 implement; storyline-model consumes it and never
/// depends on those features directly. A louder, faster-spreading concern climbs faster.
/// </summary>
public interface IAmplificationSignal
{
    /// <summary>Amplification velocity, normalized 0…1 — repost/quote momentum on the concern this window (ADP-004).</summary>
    double Velocity { get; }

    /// <summary>Audience-magnitude band (SOC-054): larger = greater reach, amplifying the bend-up.</summary>
    int AudienceBand { get; }
}

/// <summary>
/// Reaction input the sentiment model blends in (SOC-031). The seam E2's reaction aggregation implements;
/// to participants this stays an ordinary reaction picker (XC-002 — the sentiment read is staff-facing).
/// </summary>
public interface IReactionSignal
{
    /// <summary>Net reaction sentiment −1…+1 aggregated from the participant reaction picker (SOC-031).</summary>
    double NetSentiment { get; }

    /// <summary>How many reactions informed the aggregate; a low count is weighted down (weak signal).</summary>
    int SampleCount { get; }
}

/// <summary>A plain amplification signal value (for the loop/tests that just have the numbers).</summary>
public sealed record AmplificationSignal(double Velocity, int AudienceBand) : IAmplificationSignal;

/// <summary>A plain reaction signal value (for the loop/tests that just have the numbers).</summary>
public sealed record ReactionSignal(double NetSentiment, int SampleCount) : IReactionSignal;

/// <summary>
/// The per-tick external signals a storyline advances against. All optional — a tick with none supplied
/// advances on the curve + scenario time alone (<see cref="None"/>).
/// </summary>
public sealed record StorylineTickSignals
{
    /// <summary>Amplification bend-up input (ADP-004 / SOC-054). Null = no amplification this tick.</summary>
    public IAmplificationSignal? Amplification { get; init; }

    /// <summary>Reaction sentiment input (SOC-031). Null = no reaction signal this tick.</summary>
    public IReactionSignal? Reactions { get; init; }

    /// <summary>Optional light content-analysis sentiment −1…+1 for this tick's window; null = no content pass.</summary>
    public double? ContentSentiment { get; init; }

    /// <summary>The neutral signal set — curve + scenario time only.</summary>
    public static StorylineTickSignals None { get; } = new();
}
