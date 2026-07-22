namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// Composition-root guard for <see cref="EngineReviewEndpoints.AddEngineReview"/> (plain
/// <see cref="FactAttribute"/>, no Docker). Asserts the review-cockpit services are registered at the right
/// lifetimes, the auto-HOLD tick is a hosted service, and the degraded-mode
/// <see cref="EngineAutonomyProviderHealthListener"/> REPLACES the generation core's default
/// <see cref="IProviderHealthListener"/> (so a provider circuit trip drives the autonomy clamp).
/// </summary>
public sealed class EngineReviewCompositionTests
{
    [Fact]
    public void AddEngineReview_RegistersServicesAtExpectedLifetimes()
    {
        var services = new ServiceCollection();

        services.AddEngineReview();

        services.Should().Contain(
            d => d.ServiceType == typeof(EngineReviewService) && d.Lifetime == ServiceLifetime.Scoped);
        services.Should().Contain(
            d => d.ServiceType == typeof(IEngineReviewBroadcaster)
                && d.ImplementationType == typeof(EngineReviewBroadcaster)
                && d.Lifetime == ServiceLifetime.Scoped);
        services.Should().Contain(
            d => d.ServiceType == typeof(EngineAutonomyRegistry) && d.Lifetime == ServiceLifetime.Singleton);
        services.Should().Contain(
            d => d.ServiceType == typeof(IHostedService)
                && d.ImplementationType == typeof(EngineReviewTickHost),
            "the non-request-bound auto-HOLD tick must run as a hosted background service");
    }

    [Fact]
    public void AddEngineReview_ReplacesTheGenerationCoreProviderHealthListener_WithTheAutonomyFanOut()
    {
        var services = new ServiceCollection();

        // Simulate the generation core's default no-op listener already present (AddEngineGeneration wires it
        // for a real provider). AddEngineReview runs AFTER it (orchestrator ordering) and must replace it.
        services.AddSingleton<IProviderHealthListener, NoOpProviderHealthListener>();

        services.AddEngineReview();

        services.Where(d => d.ServiceType == typeof(IProviderHealthListener)).Should().ContainSingle()
            .Which.ImplementationType.Should().Be(
                typeof(EngineAutonomyProviderHealthListener),
                "the degraded-mode bridge must be the sole IProviderHealthListener so a circuit trip clamps every exercise (NFR-003/§3.5)");
    }
}
