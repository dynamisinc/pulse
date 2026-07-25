namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// Composition-root guard for <see cref="PauseOverlayServiceCollectionExtensions.AddPauseParticipantOverlay"/>
/// (world-steering/08). Docker-free (<see cref="FactAttribute"/>).
///
/// <para><b>Why a DI-RESOLUTION test, not just a descriptor assertion.</b> The #310→#317 gap was a slice that
/// merged fully green while its registration never actually took effect. Here the specific hazard is that story
/// 07's <see cref="NullPauseOverlayPublisher"/> silently survives, in which case every Freeze would still publish
/// NOTHING and no participant would ever see the holding page — with all unit tests passing. So these tests build
/// a real provider and assert the RESOLVED <see cref="IPauseOverlayPublisher"/> is the live implementation, in
/// BOTH wiring orders, and then drive a real <see cref="PauseTierRegistry"/> Freeze end-to-end through it.</para>
/// </summary>
public sealed class PauseOverlayCompositionTests
{
    [Fact]
    public void AddPauseParticipantOverlay_RegistersTheStoreAndTierReaderAsSingletons()
    {
        var services = new ServiceCollection();

        services.AddPauseParticipantOverlay();

        services.Should().Contain(
            descriptor => descriptor.ServiceType == typeof(OverlayStateService)
                && descriptor.Lifetime == ServiceLifetime.Singleton,
            "the overlay store is in-memory runtime state — one per host, like PauseTierRegistry/ExerciseClockService");
        services.Should().Contain(
            descriptor => descriptor.ServiceType == typeof(PauseTierReader)
                && descriptor.Lifetime == ServiceLifetime.Singleton);
        services.Should().Contain(
            descriptor => descriptor.ServiceType == typeof(IPauseOverlayPublisher)
                && descriptor.ImplementationType == typeof(PauseOverlayPublisher)
                && descriptor.Lifetime == ServiceLifetime.Singleton);
    }

    [Fact]
    public void AddPauseParticipantOverlay_AfterStory07_ReplacesTheNoOpDefault()
    {
        var services = new ServiceCollection();
        services.AddPauseTierSteering();

        services.AddPauseParticipantOverlay();

        services.Where(descriptor => descriptor.ServiceType == typeof(IPauseOverlayPublisher))
            .Should().ContainSingle()
            .Which.ImplementationType.Should().Be(
                typeof(PauseOverlayPublisher),
                "RemoveAll + AddSingleton must leave the REAL publisher as the sole IPauseOverlayPublisher");
    }

    [Fact]
    public void AddPauseParticipantOverlay_BeforeStory07_StillWins()
    {
        var services = new ServiceCollection();

        services.AddPauseParticipantOverlay();
        services.AddPauseTierSteering();

        services.Where(descriptor => descriptor.ServiceType == typeof(IPauseOverlayPublisher))
            .Should().ContainSingle()
            .Which.ImplementationType.Should().Be(
                typeof(PauseOverlayPublisher),
                "story 07's default is a TryAddSingleton, so it no-ops when the real publisher is already there — "
                + "the wiring order the orchestrator chooses cannot silently disable participant-visible Freeze");
    }

    [Fact]
    public void ResolvedPauseOverlayPublisher_IsTheRealImplementation_NotTheNoOpDefault()
    {
        using var provider = BuildProvider();

        provider.GetRequiredService<IPauseOverlayPublisher>().Should()
            .BeOfType<PauseOverlayPublisher>()
            .And.NotBeOfType<NullPauseOverlayPublisher>(
                "a surviving NullPauseOverlayPublisher would mean a Freeze publishes nothing and no participant "
                + "ever sees the holding page — the exact class of silent gap #310→#317 taught us to assert");
    }

    [Fact]
    public void ResolvingThePauseTierRegistry_DoesNotDeadlockOnTheOverlayPublisherCycle()
    {
        using var provider = BuildProvider();

        var registry = provider.GetRequiredService<PauseTierRegistry>();

        registry.Should().NotBeNull(
            "PauseTierRegistry depends on IPauseOverlayPublisher and the real publisher needs the registry's tier — "
            + "the PauseTierReader delegate resolves it lazily precisely so this graph is constructible");
        provider.GetRequiredService<OverlayStateService>().Should().BeSameAs(
            provider.GetRequiredService<OverlayStateService>(), "one overlay store per host");
    }

    [Fact]
    public async Task AFreezeThroughTheWiredRegistry_WritesTheParticipantOverlay_PerExercise()
    {
        // The full server-side chain as the orchestrator will wire it: POST -> PauseTierRegistry.SetTierAsync ->
        // IPauseOverlayPublisher (the real one) -> OverlayStateService, which GET /api/overlay-state serves.
        using var provider = BuildProvider();
        var registry = provider.GetRequiredService<PauseTierRegistry>();
        var overlayState = provider.GetRequiredService<OverlayStateService>();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var clockStart = new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc);

        var frozen = await registry.SetTierAsync(exerciseA, PauseTier.Freeze, "human-controller-01", clockStart);

        frozen.Outcome.Should().Be(PauseTierOutcome.Applied);
        overlayState.Get(exerciseA).State.Should().Be(
            "pause", "AC1: the Freeze transition now writes the per-exercise overlay state");
        overlayState.Get(exerciseB).State.Should().Be(
            "none", "COR-001: exercise B's participants must be untouched by A's Freeze");

        var resumed = await registry.SetTierAsync(exerciseA, PauseTier.Running, "human-controller-01", clockStart);

        resumed.Outcome.Should().Be(PauseTierOutcome.Applied);
        overlayState.Get(exerciseA).State.Should().Be("none", "AC3: Resume clears the participant holding page");
    }

    /// <summary>
    /// A provider wired exactly as <c>Program.cs</c> will be: SignalR (the shared <c>ExerciseRealtimeHub</c>'s
    /// <c>IHubContext</c> source — this feature adds no second hub), the shipped exercise clock, story 07's
    /// pause-tier steering, then this story's overlay swap.
    /// </summary>
    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSignalR();
        services.AddExerciseClock();
        services.AddPauseTierSteering();
        services.AddPauseParticipantOverlay();

        return services.BuildServiceProvider(validateScopes: true);
    }
}
