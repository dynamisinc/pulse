namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Xunit;

/// <summary>
/// Story 01 composition-root wiring: <c>AddReactionLoopHost()</c> registers the loop host + stages + the
/// single publish funnel, on a bare <see cref="ServiceCollection"/> (the orchestrator — not this builder —
/// wires the call into <c>Program.cs</c>). Model-only DI resolution → plain <see cref="FactAttribute"/>.
/// </summary>
public sealed class ReactionLoopHostDiTests
{
    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        // Prerequisites the orchestrator wires earlier (same order as Program.cs).
        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake by default
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();

        services.AddReactionLoopHost();

        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddReactionLoopHost_RegistersTheStagesAndPublishFunnel()
    {
        using var provider = BuildProvider();

        provider.GetService<GenerateStage>().Should().NotBeNull("the generate stage drives guard-before-human generation");
        provider.GetService<MeasureStage>().Should().NotBeNull("the measure stage advances storylines");
        provider.GetService<ReactionLoopDriver>().Should().NotBeNull("the driver runs each scenario-time tick");
        provider.GetService<IReactionLoopRegistry>().Should().BeOfType<ReactionLoopRegistry>();
        provider.GetService<IEnginePublishService>().Should().BeOfType<EnginePublishService>(
            "story 01 owns the single publish funnel seam story 02 also calls");
    }

    [Fact]
    public void AddReactionLoopHost_RegistersTheLoopAsAHostedService()
    {
        using var provider = BuildProvider();

        var hosted = provider.GetServices<IHostedService>();

        hosted.Should().ContainSingle(service => service is ReactionLoopHost,
            "the loop runs in-process as a BackgroundService (open question (a) — in-process for v1)");
    }

    [Fact]
    public void EnginePublishService_IsSingleton_SoBothTheLoopAndApproveShareOneFunnel()
    {
        using var provider = BuildProvider();

        var first = provider.GetRequiredService<IEnginePublishService>();
        var second = provider.GetRequiredService<IEnginePublishService>();

        second.Should().BeSameAs(first, "the funnel always builds its own scope, so it is a singleton");
    }
}
