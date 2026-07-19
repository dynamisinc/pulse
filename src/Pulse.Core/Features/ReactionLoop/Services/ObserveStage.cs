namespace Pulse.Core.Features.ReactionLoop.Services;

using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// The loop's input stage (E8 architecture §1.2, ADP-001): gather the signals that could trigger a reaction
/// — <b>inaction triggers</b> (a storyline's silence window elapsed in scenario time) and <b>addressing
/// candidates</b> (official posts / off-platform markers to be matched later). This is where "the world
/// reacts to what participants do <i>and fail to do</i>" begins; the inaction trigger is the "fail to do"
/// half.
///
/// <para>Timers run in <b>scenario time</b> (COR-050/051): observe reads each storyline's
/// <see cref="Storyline.MinutesSinceLastOfficialResponse"/>, which the loop advances via
/// <see cref="Storyline.Tick"/> against the scenario clock — so a freeze (elapsed 0) never lets a window
/// elapse and a time-jump advances it. Observe never treats an unmatched official post as silence (ADP-002a):
/// an addressing observation is surfaced as a <i>candidate</i>; matching is response-reaction's job.</para>
/// </summary>
public static class ObserveStage
{
    // A storyline is "unaddressed" — and therefore can be silent past its window — in these phases.
    private static bool IsUnaddressed(StorylinePhase phase) =>
        phase is StorylinePhase.Seeded or StorylinePhase.Escalating or StorylinePhase.Peak;

    /// <summary>
    /// Observes <paramref name="storylines"/> and <paramref name="addressing"/> at the current scenario
    /// minute, producing the tick's <see cref="ObservedSignals"/>. An inaction trigger is raised for every
    /// unaddressed storyline whose silence has reached its <see cref="Storyline.ResponseWindowMin"/>; each
    /// addressing observation is passed through as a candidate for the decide/response stages.
    /// </summary>
    public static ObservedSignals Observe(
        IReadOnlyList<Storyline> storylines,
        IReadOnlyList<AddressingObservation> addressing,
        IScenarioClock clock)
    {
        ArgumentNullException.ThrowIfNull(storylines);
        ArgumentNullException.ThrowIfNull(addressing);
        ArgumentNullException.ThrowIfNull(clock);

        var minute = clock.CurrentScenarioMinute;

        var inaction = new List<InactionTrigger>();
        foreach (var s in storylines)
        {
            if (IsUnaddressed(s.Phase) && s.MinutesSinceLastOfficialResponse >= s.ResponseWindowMin)
            {
                inaction.Add(new InactionTrigger(s.Id, s.MinutesSinceLastOfficialResponse, minute));
            }
        }

        var candidates = new List<AddressingCandidate>(addressing.Count);
        foreach (var a in addressing)
        {
            candidates.Add(new AddressingCandidate(a.Source, a.Reference, a.Text, a.StorylineHintId, minute));
        }

        return new ObservedSignals(minute, inaction, candidates);
    }
}
