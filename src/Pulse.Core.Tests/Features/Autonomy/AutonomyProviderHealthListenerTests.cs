namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Services;

public class AutonomyProviderHealthListenerTests
{
    private static readonly Guid Storyline = Guid.NewGuid();

    private static (EngineAutonomyState State, IProviderHealthListener Listener, FakeScenarioClock Clock) NewBridge(
        AutonomyLevel initial = AutonomyLevel.DelayedAuto, int minute = 50)
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid(), initial);
        var clock = new FakeScenarioClock(minute);
        return (state, new AutonomyProviderHealthListener(state, clock), clock);
    }

    [Fact]
    public async Task OnDegraded_DropsAutonomyToSuggest_StampedInScenarioTime()
    {
        var (state, listener, _) = NewBridge(minute: 50);

        await listener.OnDegradedAsync("circuit opened");

        state.ResolveEffective(Storyline).Level.Should().Be(AutonomyLevel.Suggest);
        state.SafetyClampActive.Should().BeTrue();
        state.DegradedReason.Should().Be("circuit opened");
    }

    [Fact]
    public async Task OnRecovered_ClearsTheDegradedCause_ButNeverRaisesAutonomy()
    {
        var (state, listener, clock) = NewBridge(minute: 50);
        await listener.OnDegradedAsync("circuit opened");

        clock.Advance(30);
        await listener.OnRecoveredAsync();

        // The invariant: recovery re-enables generation at the CURRENT level (Suggest) — it does not
        // escalate back to Delayed-auto. Only an explicit human restore raises it (§8.2).
        state.DegradedReason.Should().BeNull();
        state.ResolveEffective(Storyline).Level.Should().Be(AutonomyLevel.Suggest);
        state.SafetyClampActive.Should().BeTrue();
    }

    [Fact]
    public async Task DegradeThenRecover_ThenHumanRestore_ReturnsToDelayedAuto()
    {
        var (state, listener, _) = NewBridge(minute: 50);
        await listener.OnDegradedAsync("circuit opened");
        await listener.OnRecoveredAsync();

        state.RestoreFromSafety("controller:alex", 90);

        state.ResolveEffective(Storyline).Level.Should().Be(AutonomyLevel.DelayedAuto);
    }

    [Fact]
    public void DegradeToSuggest_WhenAlreadyAtFloor_IsANoChange()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid(), AutonomyLevel.Suggest);
        state.DegradeToSuggest("circuit opened", 10).Should().BeNull("already at the floor — nothing to lower");
    }

    [Fact]
    public void Constructor_RequiresSwitchAndClock()
    {
        var clock = new FakeScenarioClock();
        var state = EngineAutonomyState.Create(Guid.NewGuid());
        ((Action)(() => _ = new AutonomyProviderHealthListener(null!, clock))).Should().Throw<ArgumentNullException>();
        ((Action)(() => _ = new AutonomyProviderHealthListener(state, null!))).Should().Throw<ArgumentNullException>();
    }
}
