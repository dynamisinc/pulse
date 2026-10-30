namespace Pulse.WebApi.Features.Weather;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Kinds;

/// <summary>
/// The weather channel's one DI entry point (weather-source, E6), called once from the orchestrator-owned <c>Program.cs</c>.
/// Each backend weather story adds its registrations here, guarded by <c>WeatherCompositionRootWiringTests</c>.
/// </summary>
public static class WeatherServiceCollectionExtensions
{
    /// <summary>Registers the weather channel's services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddWeather(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Story 01: the two content kinds (FC-7). Scoped, so validation reads the exercise's own zones and products; TryAdd
        // keeps a second call from registering either kind twice.
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IContentKindDescriptor, WeatherProductDescriptor>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IContentKindDescriptor, ForecastDescriptor>());
        return services;
    }
}
