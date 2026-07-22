namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Moq;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Unit tests for the host-wide degraded-mode bridge <see cref="EngineAutonomyProviderHealthListener"/>
/// (NFR-003 / ADP-042, §3.5 / §8.2). Docker-free — it drives the built <see cref="EngineAutonomyState"/> via
/// the <see cref="EngineAutonomyRegistry"/>, with a mocked <see cref="IExerciseClock"/>. Proves the SAFETY
/// invariant that provider degradation only ever LOWERS autonomy across every active exercise, and recovery
/// clears the alert WITHOUT raising it back (a human restores explicitly).
/// </summary>
public sealed class EngineAutonomyProviderHealthListenerTests
{
    private static IExerciseClock ClockAtMinute(int minute)
    {
        var clock = new Mock<IExerciseClock>();
        clock.Setup(c => c.CurrentScenarioMinute(It.IsAny<Guid>())).Returns(minute);
        return clock.Object;
    }

    [Fact]
    public async Task OnDegraded_ClampsEveryActiveExerciseToSuggest()
    {
        var registry = new EngineAutonomyRegistry();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var storyline = Guid.NewGuid();
        registry.GetOrCreate(exerciseA).SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-a", 0);
        registry.GetOrCreate(exerciseB).SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-b", 0);

        var listener = new EngineAutonomyProviderHealthListener(registry, ClockAtMinute(7));

        await listener.OnDegradedAsync("generation provider circuit opened");

        registry.GetOrCreate(exerciseA).ResolveEffective(storyline).Level.Should().Be(
            AutonomyLevel.Suggest, "a provider circuit trip fans DegradeToSuggest out to every active exercise (only ever lowers, §8.2)");
        registry.GetOrCreate(exerciseB).ResolveEffective(storyline).Level.Should().Be(AutonomyLevel.Suggest);
    }

    [Fact]
    public async Task OnRecovered_ClearsTheAlert_ButNeverRaisesAutonomy()
    {
        var registry = new EngineAutonomyRegistry();
        var exerciseId = Guid.NewGuid();
        var storyline = Guid.NewGuid();
        registry.GetOrCreate(exerciseId).SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead", 0);

        var listener = new EngineAutonomyProviderHealthListener(registry, ClockAtMinute(3));
        await listener.OnDegradedAsync("circuit opened");
        await listener.OnRecoveredAsync();

        var state = registry.GetOrCreate(exerciseId);
        state.DegradedReason.Should().BeNull("recovery clears the degraded alert");
        state.ResolveEffective(storyline).Level.Should().Be(
            AutonomyLevel.Suggest, "recovery NEVER raises autonomy — a controller restores the pre-incident level explicitly (§8.2)");
    }
}
