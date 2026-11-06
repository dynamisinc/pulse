namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Composition-root seams for the exercise real-time transport. The orchestrator wires these from
/// <c>Program.cs</c> (this story never edits it): <see cref="AddSocialRealtimeHub"/> registers the hub's
/// services and the <see cref="IFeedBroadcaster"/> implementation, and <see cref="MapSocialRealtimeHub"/>
/// maps the hub endpoint.
/// </summary>
public static class RealtimeExtensions
{
    /// <summary>The route the exercise-scoped SignalR hub is mapped at.</summary>
    private const string HubRoute = "/hubs/exercise";

    /// <summary>
    /// Registers SignalR and the SignalR-backed <see cref="IFeedBroadcaster"/> (<see cref="SignalRFeedBroadcaster"/>,
    /// consumed by story 02's post-write path) in the service collection.
    /// </summary>
    /// <param name="services">The service collection to add to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddSocialRealtimeHub(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSignalR();
        services.AddScoped<IFeedBroadcaster, SignalRFeedBroadcaster>();

        // #375: the broadcaster's EndEx send gate reads the exercise's lifecycle status before every send. The same
        // TryAdd the pause overlay uses, so whichever registers first wins and a host's own reader is never replaced.
        services.TryAddExerciseLifecycleStatusReader();

        // channels-foundation 09: the content frames' disabled-channel gate reads the exercise's enabled set per send.
        services.TryAddExerciseChannelEnabledReader();

        // identity-auth-roles/16: the connection → session registry the grant-revoke rule cuts connections through.
        services.TryAddSingleton<SessionConnectionRegistry>();
        services.TryAddSingleton<ISessionConnectionRevoker, SessionConnectionRevoker>();

        return services;
    }

    /// <summary>
    /// Maps <see cref="ExerciseRealtimeHub"/> at <c>/hubs/exercise</c>.
    /// </summary>
    /// <param name="endpoints">The endpoint route builder to map onto.</param>
    /// <returns>The same <paramref name="endpoints"/> for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialRealtimeHub(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapHub<ExerciseRealtimeHub>(HubRoute);

        return endpoints;
    }
}
