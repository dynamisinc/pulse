namespace Pulse.Core.Tests.Features.Storylines;

using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// A controllable <see cref="IScenarioClock"/> for tests. Advancing it models scenario time passing;
/// holding it models a freeze (CTL-023); jumping it models a time-jump (CTL-015).
/// </summary>
internal sealed class FakeScenarioClock : IScenarioClock
{
    public FakeScenarioClock(int minute = 0) => CurrentScenarioMinute = minute;

    public int CurrentScenarioMinute { get; private set; }

    /// <summary>Advance scenario time by <paramref name="minutes"/> (a jump when large; a freeze when 0).</summary>
    public FakeScenarioClock Advance(int minutes)
    {
        CurrentScenarioMinute += minutes;
        return this;
    }

    /// <summary>Set the scenario minute absolutely.</summary>
    public FakeScenarioClock Set(int minute)
    {
        CurrentScenarioMinute = minute;
        return this;
    }
}
