namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.WhiteNoise;
using Xunit;

/// <summary>
/// demo-feedback story 18 composition: <c>AddExerciseRuntimePersistence()</c> replaces the no-op persister and clock
/// sink in either wiring order, resolves without a DI cycle, and — called where seam S-5 will call it — puts
/// <see cref="ExerciseRuntimeStateRehydrator"/> FIRST among the hosted services, ahead of every ticking one.
/// The two <c>Program.cs</c>-level assertions are written and SKIPPED until S-5 wires the lines.
/// </summary>
public sealed class RuntimePersistenceCompositionTests
{
    private const string AwaitingS5 =
        "Seam S-5 (orchestrator) adds AddExerciseRuntimePersistence() + MapRuntimeStateReset() to Program.cs; unskip then.";

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AddExerciseRuntimePersistence_ReplacesTheNoOpDefaults_InEitherOrder(bool persistenceFirst)
    {
        var services = BaseServices();
        if (persistenceFirst)
        {
            services.AddExerciseRuntimePersistence();
            services.AddExerciseClock();
            services.AddPauseTierSteering();
        }
        else
        {
            services.AddExerciseClock();
            services.AddPauseTierSteering();
            services.AddExerciseRuntimePersistence();
        }

        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = false });

        provider.GetRequiredService<IExerciseRuntimeStatePersister>().Should().BeOfType<ExerciseRuntimeStateWriter>(
            "a surviving no-op persister would make every tier change silently in-memory only");
        provider.GetRequiredService<IExerciseClockChangeSink>().Should().BeOfType<ExerciseClockWriteThrough>(
            "a surviving no-op sink would make clock-only changes (the loop's Start, a Jump) unpersisted");
        provider.GetRequiredService<IExerciseClock>().Should().BeOfType<ExerciseClockService>();
        provider.GetRequiredService<PauseTierRegistry>().Should().NotBeNull("the registry -> persister -> clock graph has no cycle");
        provider.GetServices<IHostedService>().OfType<ExerciseRuntimeStateRehydrator>().Should().ContainSingle();
    }

    [Fact]
    public void WithoutPersistence_ThePauseTierKeepsItsPreStory18NoOps()
    {
        var services = BaseServices();
        services.AddExerciseClock();
        services.AddPauseTierSteering();

        using var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IExerciseRuntimeStatePersister>().Should().BeOfType<NullExerciseRuntimeStatePersister>();
        provider.GetRequiredService<IExerciseClockChangeSink>().Should().BeOfType<NullExerciseClockChangeSink>();
    }

    [Fact]
    public void CalledBeforeTheTickingHosts_TheRehydratorIsTheFirstHostedService()
    {
        // The S-5 placement: AddExerciseRuntimePersistence() before AddReactionLoopHost(), AddEngineReview(),
        // AddInjects() and AddWhiteNoise(). The host awaits StartAsync in registration order.
        var services = BaseServices();
        services.AddExerciseRuntimePersistence();
        services.AddReactionLoopHost();
        services.AddEngineReview();
        services.AddInjects();
        services.AddWhiteNoise();

        var hosted = services
            .Where(descriptor => descriptor.ServiceType == typeof(IHostedService))
            .Select(descriptor => descriptor.ImplementationType)
            .ToList();

        hosted.First().Should().Be(typeof(ExerciseRuntimeStateRehydrator));
        hosted.Should().Contain([typeof(ReactionLoopHost), typeof(EngineReviewTickHost), typeof(InjectBurstRunner), typeof(WhiteNoisePacer)]);
    }

    [Fact(Skip = AwaitingS5)]
    public void ProgramCs_RegistersTheRehydrator_BeforeEveryTickingHostedService()
    {
        using var factory = new WiringProbeFactory();

        var hosted = factory.Services.GetServices<IHostedService>().Select(service => service.GetType()).ToList();

        var rehydrator = hosted.IndexOf(typeof(ExerciseRuntimeStateRehydrator));
        rehydrator.Should().BeGreaterThanOrEqualTo(0, "Program.cs must call AddExerciseRuntimePersistence()");
        foreach (var ticking in new[] { typeof(ReactionLoopHost), typeof(EngineReviewTickHost), typeof(InjectBurstRunner), typeof(WhiteNoisePacer) })
        {
            hosted.IndexOf(ticking).Should().BeGreaterThan(rehydrator, "{0} must not tick before the state is restored", ticking.Name);
        }
    }

    [Fact(Skip = AwaitingS5)]
    public void ProgramCs_MapsTheRuntimeResetRoute_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        dataSource.Endpoints.OfType<RouteEndpoint>().Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, ExerciseRuntimePersistenceEndpoints.ResetRoute, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") ?? false))
            .Should().Be(1, "MapRuntimeStateReset() must be wired into Program.cs exactly once (S-5)");
    }

    private static ServiceCollection BaseServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        return services;
    }

    /// <summary>Boots the real <c>Program</c> host with a never-connecting connection string (see the demo-feedback wiring tests).</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public WiringProbeFactory()
        {
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
