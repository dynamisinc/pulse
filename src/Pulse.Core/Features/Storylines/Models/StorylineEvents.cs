namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Domain events a storyline emits as it changes state. This feature is <b>pure domain logic</b>: it
/// <i>produces</i> these events and returns them from its operations; it does not depend on a telemetry
/// sink. <c>engine-telemetry-tuning</c> maps them onto the XC-004 event taxonomy
/// (<c>storyline.state_changed</c>, <c>engine.measured</c>) and stamps wall-clock time. All events carry
/// scenario time (COR-050/051); every event is staff-only (XC-002).
/// </summary>
public interface IStorylineEvent
{
    /// <summary>The storyline the event is about.</summary>
    Guid StorylineId { get; }

    /// <summary>Scenario minutes since exercise start when the event occurred (COR-050/051).</summary>
    int ScenarioMinute { get; }
}

/// <summary>
/// A storyline phase transition (maps to <c>storyline.state_changed</c>, §11). Carries from→to and the
/// cause so a hotwash can explain <i>why</i> the world turned — curve, matched response, dial target, or
/// off-platform marker.
/// </summary>
public sealed record StorylineStateChanged(
    Guid StorylineId,
    StorylinePhase From,
    StorylinePhase To,
    StorylineCause Cause,
    int ScenarioMinute) : IStorylineEvent;
