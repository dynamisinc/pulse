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
    public async Task OnDegraded_ForwardsTheTransition_ToTheSink_ForTelemetry()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid(), AutonomyLevel.DelayedAuto);
        var logged = new List<IAutonomyEvent>();
        var listener = new AutonomyProviderHealthListener(state, new FakeScenarioClock(50), logged.Add);

        await listener.OnDegradedAsync("circuit opened");

        logged.Should().ContainSingle();
        logged[0].Should().BeOfType<AutonomyLevelChanged>()
            .Which.Should().BeEquivalentTo(new
            {
                From = AutonomyLevel.DelayedAuto,
                To = AutonomyLevel.Suggest,
                Cause = AutonomyChangeCause.DegradedMode,
                ScenarioMinute = 50,
            });
    }

    [Fact]
    public async Task OnDegraded_WhenAlreadyAtFloor_ForwardsNothing()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid(), AutonomyLevel.Suggest);
        var logged = new List<IAutonomyEvent>();
        var listener = new AutonomyProviderHealthListener(state, new FakeScenarioClock(50), logged.Add);

        await listener.OnDegradedAsync("circuit opened");

        logged.Should().BeEmpty("no autonomy change to log when already at the floor");
    }

    [Fact]
    public void RestoreFromSafety_ClearsTheDegradedAlert_SoItNeverOutlivesTheClamp()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid(), AutonomyLevel.DelayedAuto);
        state.DegradeToSuggest("circuit opened", 10);
        state.DegradedReason.Should().NotBeNull();

        state.RestoreFromSafety("controller:alex", 40);

        state.DegradedReason.Should().BeNull("a manual restore clears the stale degraded banner");
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
