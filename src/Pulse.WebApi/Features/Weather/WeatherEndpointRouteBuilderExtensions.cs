namespace Pulse.WebApi.Features.Weather;

using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.Weather.Zones;

/// <summary>
/// The weather channel's one route entry point (weather-source, E6), called once from the orchestrator-owned
/// <c>Program.cs</c> as <c>app.MapWeather()</c>.
/// </summary>
/// <remarks>
/// Story 02 maps the zone API (<c>/api/weather/zones*</c>). Later weather backend stories (03 site read, 05 timeline, 15
/// sample seed) add their <c>Map*</c> calls HERE, guarded by <c>WeatherCompositionRootWiringTests</c>; none edits
/// <c>Program.cs</c>.
/// </remarks>
public static class WeatherEndpointRouteBuilderExtensions
{
    /// <summary>Maps the weather channel's routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapWeather(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapWeatherZones(); // story 02: /api/weather/zones*

        return endpoints;
    }
}
