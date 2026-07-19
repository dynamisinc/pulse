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

/// <summary>What moved a storyline's intensity/sentiment on a measured tick (§6.2), for the telemetry cause.</summary>
public enum MeasureCause
{
    /// <summary>Natural rise/decay along the escalation curve + scenario time.</summary>
    Curve,

    /// <summary>Amplification velocity + audience magnitude bent intensity up (ADP-004 / SOC-054).</summary>
    Amplification,

    /// <summary>A matched official response bent intensity/sentiment down (ADP-002).</summary>
    MatchedResponse,
}

/// <summary>
/// An intensity/sentiment measurement on a storyline (maps to <c>engine.measured</c>, §11). Carries the
/// delta, the resulting values, and the cause so E10 can render the arc with dial-input overlays
/// (EVL-014) and separate designed pressure from participant-driven pressure. Staff/evaluator-facing
/// (XC-002).
/// </summary>
public sealed record StorylineMeasured(
    Guid StorylineId,
    int IntensityDelta,
    int Intensity,
    double Sentiment,
    MeasureCause Cause,
    int ScenarioMinute) : IStorylineEvent;

/// <summary>The kind of controller steering action recorded on a storyline (XC-004 steering-action log).</summary>
public enum SteeringActionKind
{
    /// <summary>The escalation curve was reassigned live (ADP-010, story 03).</summary>
    CurveChanged,

    /// <summary>The dial target intensity was set, changed, or cleared (CTL-022, story 05).</summary>
    TargetChanged,
}

/// <summary>
/// A controller steering action against a storyline (curve reassignment, dial-target change) — logged as
/// an XC-004 steering action so E10 can attribute a shift in the world to a controller decision rather
/// than to participant-driven pressure (EVL-014, no sentiment circularity). Staff-only (XC-002).
/// </summary>
public sealed record SteeringActionLogged(
    Guid StorylineId,
    SteeringActionKind Kind,
    string Detail,
    int ScenarioMinute) : IStorylineEvent;
