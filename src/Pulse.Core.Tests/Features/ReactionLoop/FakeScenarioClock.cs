namespace Pulse.Core.Tests.Features.ReactionLoop;

using Pulse.Core.Features.Storylines.Services;

/// <summary>A controllable <see cref="IScenarioClock"/>: advance = time passing, hold = freeze, jump = time-jump.</summary>
internal sealed class FakeScenarioClock(int minute = 0) : IScenarioClock
{
    public int CurrentScenarioMinute { get; private set; } = minute;

    public FakeScenarioClock Set(int minute)
    {
        CurrentScenarioMinute = minute;
        return this;
    }
}
