namespace Pulse.Core.Features.Storylines.Services;

/// <summary>
/// The scenario clock seam (COR-050/051). Every storyline timer runs in <b>scenario time</b>, never
/// wall-clock: a time-jump (CTL-015) leaps <see cref="CurrentScenarioMinute"/> forward and a freeze
/// (CTL-023) stops it advancing, so silence windows and escalation move (or halt) with the scenario, not
/// with real time. The real clock is E1's and isn't built yet; the reaction loop supplies an
/// implementation and this feature depends only on this interface.
/// </summary>
public interface IScenarioClock
{
    /// <summary>Scenario minutes elapsed since exercise start. Monotonic under normal running; leaps on a
    /// time-jump; holds constant while the scenario is frozen.</summary>
    int CurrentScenarioMinute { get; }
}
