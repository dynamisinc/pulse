namespace Pulse.WebApi.Tests.Features.Weather;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather;
using Pulse.WebApi.Features.Weather.Kinds;

/// <summary>
/// Composition-root guard for the weather channel (FC-9.10; plain <see cref="FactAttribute"/>s, no Docker): boots the REAL
/// <c>Program</c> host and proves <c>AddWeather()</c> is wired — story 01's two kind descriptors resolve, scoped, from a
/// request scope. Later weather backend stories (02, 03, 04, 05, 15) extend this file as they fill <c>AddWeather()</c>.
/// </summary>
public sealed class WeatherCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_ResolvesBothWeatherKindDescriptors_Scoped()
    {
        using var factory = new WiringProbeFactory();
        using var scopeA = factory.Services.CreateScope();
        using var scopeB = factory.Services.CreateScope();
        ((ExerciseContext)scopeA.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        var descriptors = scopeA.ServiceProvider.GetServices<IContentKindDescriptor>().ToList();
        var weather = descriptors.Where(d => d.ChannelId == ChannelVocabulary.Weather).ToList();

        weather.Select(d => d.Kind).Should().BeEquivalentTo(["weather_product", "forecast"]);
        weather.Should().OnlyContain(d => d.BodyPolicy == ISanitizerProfileRegistry.Plain);
        descriptors.GroupBy(d => d.Kind).Should().OnlyContain(g => g.Count() == 1, "a kind is registered once");

        scopeA.ServiceProvider.GetServices<IContentKindDescriptor>().OfType<WeatherProductDescriptor>().Single()
            .Should().BeSameAs(weather.OfType<WeatherProductDescriptor>().Single(), "descriptors are scoped");
        scopeB.ServiceProvider.GetServices<IContentKindDescriptor>().OfType<WeatherProductDescriptor>().Single()
            .Should().NotBeSameAs(weather.OfType<WeatherProductDescriptor>().Single(), "a new scope gets new descriptors");
    }

    [Fact]
    public void AddWeather_IsIdempotent()
    {
        var services = new ServiceCollection();

        services.AddWeather().AddWeather().Should().BeSameAs(services);

        services.Where(d => d.ServiceType == typeof(IContentKindDescriptor)).Select(d => d.ImplementationType)
            .Should().BeEquivalentTo([typeof(WeatherProductDescriptor), typeof(ForecastDescriptor)]);
        services.Should().OnlyContain(d => d.Lifetime == ServiceLifetime.Scoped);
    }

    /// <summary>Boots the real <c>Program</c> host with a dummy, never-connecting connection string. Overrides nothing else.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory()
        {
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
