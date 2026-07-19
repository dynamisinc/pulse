namespace Pulse.Core.Tests.Features.Autonomy;

using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// A controllable <see cref="IScenarioClock"/> for autonomy tests. Advancing models scenario time passing;
/// holding models a freeze (CTL-023); jumping models a time-jump (CTL-015). (The autonomy domain logic is
/// otherwise decoupled from the clock — only the degraded-mode listener stamps events with it.)
/// </summary>
internal sealed class FakeScenarioClock : IScenarioClock
{
    public FakeScenarioClock(int minute = 0) => CurrentScenarioMinute = minute;

    public int CurrentScenarioMinute { get; private set; }

    public FakeScenarioClock Set(int minute)
    {
        CurrentScenarioMinute = minute;
        return this;
    }

    public FakeScenarioClock Advance(int minutes)
    {
        CurrentScenarioMinute += minutes;
        return this;
    }
}
