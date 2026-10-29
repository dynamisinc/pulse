namespace Pulse.WebApi.Tests;

using System.IO;
using FluentAssertions;
using Microsoft.ApplicationInsights.Channel;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.ApplicationInsights;
using Pulse.Core.Core.Extensions;

/// <summary>
/// Regression for the UAT telemetry blackout (2026-10-19 12:16Z onward). Program.cs calls
/// <c>AddEngineGeneration</c> before <c>AddApplicationInsightsTelemetry</c>. With a live provider the
/// generation seam registers a resilience handler, which brings keyed services into the collection.
/// Microsoft.ApplicationInsights.AspNetCore 2.22.0 threw a NullReferenceException scanning those
/// descriptors and swallowed it, so it registered no channel and no logger provider: the API served
/// normally and sent nothing. Fake (the CI default) never reproduced it, so this pins the live ordering.
/// </summary>
public sealed class ApplicationInsightsRegistrationTests
{
    private static readonly string FixtureDir = Path.Combine(AppContext.BaseDirectory, "ConfigFixtures");

    [Theory]
    [InlineData("appsettings.json")]
    [InlineData("appsettings.Generation.Example.json")]
    public void AddApplicationInsightsTelemetry_AfterGenerationSeam_RegistersChannelAndLogger(string fixture)
    {
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(FixtureDir, fixture), optional: false)
            .Build();
        var services = new ServiceCollection();

        services.AddEngineGeneration(configuration);
        services.AddApplicationInsightsTelemetry();

        services.Should().Contain(
            d => d.ServiceType == typeof(ITelemetryChannel),
            "without a channel App Insights receives nothing (requests, traces, dependencies, exceptions)");
        services.Should().Contain(
            d => d.ServiceType == typeof(ILoggerProvider)
                && !d.IsKeyedService
                && d.ImplementationType == typeof(ApplicationInsightsLoggerProvider),
            "ILogger output (engine.* events, EF warnings) reaches App Insights only through this provider");
    }
}
