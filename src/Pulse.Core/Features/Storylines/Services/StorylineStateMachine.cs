namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The storyline phase transition table (E8 architecture §6.1). Pure and stateless: it answers
/// "from this phase, does this trigger lead anywhere, and where?" — nothing here mutates a storyline.
/// The <see cref="Storyline"/> aggregate drives itself through this table (see
/// <see cref="Storyline.Transition"/>); keeping the table separate makes the legal graph independently
/// testable and impossible to sidestep with an ad-hoc phase assignment.
/// </summary>
public static class StorylineStateMachine
{
    // (from, trigger) -> to. Any pair absent from this map is an illegal transition (rejected, §6.1).
    private static readonly Dictionary<(StorylinePhase From, StorylineTrigger Trigger), StorylinePhase> Table =
        new()
        {
            [(StorylinePhase.Dormant, StorylineTrigger.Seed)] = StorylinePhase.Seeded,

            // Seeded opens to Escalating on window elapse or early activity; can be answered pre-emptively.
            [(StorylinePhase.Seeded, StorylineTrigger.WindowOpened)] = StorylinePhase.Escalating,
            [(StorylinePhase.Seeded, StorylineTrigger.ActivityDetected)] = StorylinePhase.Escalating,
            [(StorylinePhase.Seeded, StorylineTrigger.OfficialResponseMatched)] = StorylinePhase.Addressed,

            // Escalating tops out to Peak when unaddressed, or is calmed by a matched response.
            [(StorylinePhase.Escalating, StorylineTrigger.LeftUnaddressed)] = StorylinePhase.Peak,
            [(StorylinePhase.Escalating, StorylineTrigger.OfficialResponseMatched)] = StorylinePhase.Addressed,

            // Peak can only be brought down by a matched response.
            [(StorylinePhase.Peak, StorylineTrigger.OfficialResponseMatched)] = StorylinePhase.Addressed,

            // Addressed decays to the floor, then resolves.
            [(StorylinePhase.Addressed, StorylineTrigger.DecayBegan)] = StorylinePhase.Decaying,
            [(StorylinePhase.Decaying, StorylineTrigger.ReachedFloor)] = StorylinePhase.Resolved,

            // A new unaddressed trigger re-opens a decaying or resolved concern (§6.1 re-open edge).
            [(StorylinePhase.Decaying, StorylineTrigger.NewUnaddressedTrigger)] = StorylinePhase.Escalating,
            [(StorylinePhase.Resolved, StorylineTrigger.NewUnaddressedTrigger)] = StorylinePhase.Escalating,
        };

    /// <summary>Whether <paramref name="trigger"/> is legal from <paramref name="from"/>.</summary>
    public static bool CanTransition(StorylinePhase from, StorylineTrigger trigger) =>
        Table.ContainsKey((from, trigger));

    /// <summary>
    /// The phase <paramref name="trigger"/> leads to from <paramref name="from"/>, or <c>null</c> if the
    /// transition is illegal.
    /// </summary>
    public static StorylinePhase? Target(StorylinePhase from, StorylineTrigger trigger) =>
        Table.TryGetValue((from, trigger), out var to) ? to : null;

    /// <summary>
    /// The default cause a trigger records on the telemetry event. A caller may override it (e.g. an
    /// off-platform marker or a dial-driven transition) when constructing the event.
    /// </summary>
    public static StorylineCause DefaultCause(StorylineTrigger trigger) => trigger switch
    {
        StorylineTrigger.Seed => StorylineCause.Seed,
        StorylineTrigger.WindowOpened => StorylineCause.WindowOpened,
        StorylineTrigger.ActivityDetected => StorylineCause.Activity,
        StorylineTrigger.LeftUnaddressed => StorylineCause.Unaddressed,
        StorylineTrigger.OfficialResponseMatched => StorylineCause.MatchedResponse,
        StorylineTrigger.DecayBegan => StorylineCause.CurveDecay,
        StorylineTrigger.ReachedFloor => StorylineCause.CurveDecay,
        StorylineTrigger.NewUnaddressedTrigger => StorylineCause.ReOpened,
        _ => StorylineCause.Activity,
    };
}

/// <summary>
/// Thrown when a storyline transition is not legal from the current phase (E8 architecture §6.1). The
/// message names the phase and trigger so an invalid drive is a clear failure, never a silent no-op that
/// would let a storyline skip escalation or resurrect from Resolved without a re-open.
/// </summary>
public sealed class InvalidStorylineTransitionException : Exception
{
    public InvalidStorylineTransitionException()
    {
    }

    public InvalidStorylineTransitionException(string message)
        : base(message)
    {
    }

    public InvalidStorylineTransitionException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Builds the exception for a specific illegal (phase, trigger) pair.</summary>
    public static InvalidStorylineTransitionException For(StorylinePhase from, StorylineTrigger trigger) =>
        new($"Illegal storyline transition: '{trigger}' is not valid from phase '{from}'.");
}
