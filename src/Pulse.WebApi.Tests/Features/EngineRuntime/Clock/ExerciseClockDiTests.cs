namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// Story 03 AC-4 (swappable provider): <c>AddExerciseClock()</c> registers the native
/// <see cref="IExerciseClock"/> (singleton) and the engine-facing <see cref="IScenarioClock"/> adapter
/// (scoped) — provider selection following the <c>AddEngineGeneration</c> DI pattern, so a Phase-4 Cadence
/// provider is a registration swap behind the same interface. Exercised on a bare
/// <see cref="ServiceCollection"/> because the orchestrator (not this builder) wires the call into
/// <c>Program.cs</c>; the adapter's <see cref="IExerciseContext"/> prerequisite (from <c>AddExerciseScoping</c>)
/// is stubbed here.
/// </summary>
public sealed class ExerciseClockDiTests
{
    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext());
        services.AddExerciseClock();
        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddExerciseClock_registersNativeExerciseClock_asSingleton()
    {
        using var provider = BuildProvider();

        var first = provider.GetService<IExerciseClock>();
        var second = provider.GetService<IExerciseClock>();

        first.Should().BeOfType<ExerciseClockService>("the native clock is the v1 provider");
        second.Should().BeSameAs(first, "the clock is a singleton — the one clock the host reads");
    }

    [Fact]
    public void AddExerciseClock_registersScenarioClockAdapter_forTheEngineSeam()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var scenario = scope.ServiceProvider.GetService<IScenarioClock>();

        scenario.Should().BeOfType<ScenarioClockAdapter>(
            "the engine reads IScenarioClock, adapted over the native clock without changing Pulse.Core");
    }

    [Fact]
    public void AddExerciseClock_registersTimeProvider_whenHostSuppliesNone()
    {
        using var provider = BuildProvider();

        provider.GetService<TimeProvider>().Should().NotBeNull();
    }
}
