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
///
/// <para><b>Cadence gate (level → cadenced, ADP-011).</b> The inaction trigger is a LEVEL condition — a
/// storyline stays silent past its window for as long as officials stay silent — so a naive raise-on-level
/// would re-fire every tick and flood the review queue with near-identical bursts. Observe therefore also
/// requires the per-storyline <b>reaction cadence</b> to have elapsed: it re-reacts to a storyline's ongoing,
/// still-unaddressed silence at most once per <paramref name="minMinutesBetweenReactions"/> scenario minutes
/// (the loop records each reaction via <see cref="Storyline.RecordEngineReaction"/>). The very first reaction
/// still fires immediately when the window opens (a never-reacted storyline is never suppressed), and passing
/// a cadence of 0 disables the gate — the pre-existing level behaviour, so existing callers/tests are
/// unaffected.</para>
/// </summary>
public static class ObserveStage
{
    // A storyline is "unaddressed" — and therefore can be silent past its window — in these phases.
    private static bool IsUnaddressed(StorylinePhase phase) =>
        phase is StorylinePhase.Seeded or StorylinePhase.Escalating or StorylinePhase.Peak;

    // The reaction cadence has elapsed when the engine has never reacted to this storyline, the cadence gate
    // is disabled (<= 0), or at least `cadence` scenario minutes have passed since the last engine reaction.
    private static bool ReactionCadenceElapsed(Storyline s, int minute, int cadence)
    {
        if (s.LastEngineReactionScenarioMinute is not { } last)
        {
            return true; // never reacted → fire (the first reaction is immediate)
        }

        if (cadence <= 0)
        {
            return true;
        }

        return minute - last >= cadence;
    }

    /// <summary>
    /// Observes <paramref name="storylines"/> and <paramref name="addressing"/> at the current scenario
    /// minute, producing the tick's <see cref="ObservedSignals"/>. An inaction trigger is raised for every
    /// unaddressed storyline whose silence has reached its <see cref="Storyline.ResponseWindowMin"/> AND whose
    /// reaction cadence has elapsed (see the type remarks); each addressing observation is passed through as a
    /// candidate for the decide/response stages.
    /// </summary>
    /// <param name="storylines">The storylines to observe.</param>
    /// <param name="addressing">Official posts / off-platform markers surfaced as addressing candidates.</param>
    /// <param name="clock">The scenario clock supplying the current scenario minute.</param>
    /// <param name="minMinutesBetweenReactions">
    /// The per-storyline reaction cadence in scenario minutes (ADP-011). Defaulted to 0 (cadence gate
    /// disabled = pre-existing level behaviour) so existing callers/tests still compile.
    /// </param>
    public static ObservedSignals Observe(
        IReadOnlyList<Storyline> storylines,
        IReadOnlyList<AddressingObservation> addressing,
        IScenarioClock clock,
        int minMinutesBetweenReactions = 0)
    {
        ArgumentNullException.ThrowIfNull(storylines);
        ArgumentNullException.ThrowIfNull(addressing);
        ArgumentNullException.ThrowIfNull(clock);

        var minute = clock.CurrentScenarioMinute;

        var inaction = new List<InactionTrigger>();
        foreach (var s in storylines)
        {
            if (IsUnaddressed(s.Phase)
                && s.MinutesSinceLastOfficialResponse >= s.ResponseWindowMin
                && ReactionCadenceElapsed(s, minute, minMinutesBetweenReactions))
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
