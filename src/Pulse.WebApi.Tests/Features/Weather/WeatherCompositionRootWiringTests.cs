namespace Pulse.WebApi.Tests.Features.Weather;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather;
using Pulse.WebApi.Features.Weather.Contracts;
using Pulse.WebApi.Features.Weather.Kinds;
using Pulse.WebApi.Features.Weather.Zones;

/// <summary>
/// Composition-root guard for the weather channel (FC-9.10; plain <see cref="FactAttribute"/>s, no Docker): boots the REAL
/// <c>Program</c> host and proves <c>AddWeather()</c> is wired — story 01's two kind descriptors resolve, scoped, from a
/// request scope; story 02's zone catalog and service resolve and its <c>/api/weather/zones*</c> routes are mapped once by
/// <c>MapWeather()</c> and refuse an anonymous caller (the channel gate itself is proved on the real-SQL host).
/// Later weather backend stories (03, 04, 05, 15) extend this file as they fill <c>AddWeather()</c> / <c>MapWeather()</c>.
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
        services.Count(d => d.ServiceType == typeof(IWeatherZoneCatalog)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(WeatherZoneService)).Should().Be(1);
        services.Should().OnlyContain(d => d.Lifetime == ServiceLifetime.Scoped);
    }

    [Fact]
    public void ProgramCs_ResolvesTheZoneCatalogAndService_Scoped()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IWeatherZoneCatalog>().Should().BeOfType<WeatherZoneCatalog>(
            "without it story 01's validators fail closed with zone_catalog_unavailable");
        scope.ServiceProvider.GetRequiredService<WeatherZoneService>().Should().NotBeNull();
    }

    /// <summary>Story 02: every <c>/api/weather/zones*</c> route, mapped by <c>MapWeather()</c>.</summary>
    /// <returns>The method and raw route pattern of each route.</returns>
    public static TheoryData<string, string> ZoneRoutes() => new()
    {
        { "GET", "/api/weather/zones" },
        { "GET", "/api/weather/zones/staff" },
        { "POST", "/api/weather/zones" },
        { "PUT", "/api/weather/zones/{id:guid}" },
        { "DELETE", "/api/weather/zones/{id:guid}" },
    };

    [Fact]
    public void ProgramCs_MapsEveryZoneRoute_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        foreach (var route in ZoneRoutes())
        {
            var (method, pattern) = ((string)route[0], (string)route[1]);
            dataSource.Endpoints
                .OfType<RouteEndpoint>()
                .Count(endpoint =>
                    string.Equals(endpoint.RoutePattern.RawText, pattern, StringComparison.OrdinalIgnoreCase)
                    && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false))
                .Should().Be(1, "{0} {1} must be wired into Program.cs exactly once (MapWeather -> MapWeatherZones)", method, pattern);
        }
    }

    [Theory]
    [InlineData("GET", "/api/weather/zones")]
    [InlineData("GET", "/api/weather/zones/staff")]
    [InlineData("POST", "/api/weather/zones")]
    [InlineData("PUT", "/api/weather/zones/00000000-0000-0000-0000-000000000001")]
    [InlineData("DELETE", "/api/weather/zones/00000000-0000-0000-0000-000000000001?version=1")]
    public async Task AnAnonymousCallToAZoneRoute_IsRefused_NeverA404(string method, string path)
    {
        using var factory = new WiringProbeFactory();
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0} {1}: an anonymous caller is refused before any handler (an unwired route would 404)", method, path);
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
