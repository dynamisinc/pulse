namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The outcome of advancing a storyline one tick in scenario time. Bundles the intensity change, the new
/// sentiment, and every domain event raised (phase transitions + the <see cref="StorylineMeasured"/>
/// measurement) so the reaction loop can forward them to telemetry (engine-telemetry-tuning) without the
/// storyline model depending on a telemetry sink.
/// </summary>
public sealed record StorylineTickResult
{
    /// <summary>The scenario minute this tick was evaluated at (COR-050/051).</summary>
    public required int ScenarioMinute { get; init; }

    /// <summary>Scenario minutes elapsed since the previous tick (0 while frozen; large after a time-jump).</summary>
    public required int ElapsedScenarioMinutes { get; init; }

    /// <summary>Intensity before this tick.</summary>
    public required int IntensityBefore { get; init; }

    /// <summary>Intensity after this tick (0–100).</summary>
    public required int IntensityAfter { get; init; }

    /// <summary>Signed intensity change this tick.</summary>
    public int IntensityDelta => IntensityAfter - IntensityBefore;

    /// <summary>Sentiment after this tick (−1…+1).</summary>
    public required double Sentiment { get; init; }

    /// <summary>Every event raised this tick, in order (state changes then the measurement).</summary>
    public IReadOnlyList<IStorylineEvent> Events { get; init; } = [];

    /// <summary>The phase transitions raised this tick (may be empty, or several after a time-jump).</summary>
    public IEnumerable<StorylineStateChanged> StateChanges => Events.OfType<StorylineStateChanged>();
}
