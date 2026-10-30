namespace Pulse.WebApi.Features.Channels;

using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Content.Publish;

/// <summary>
/// The channels foundation's one DI entry point (FC-9.10), called once from the orchestrator-owned <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// Story 01 ships schema only — the channel entities live in <c>PulseDbContext</c>, which <c>AddPulsePersistence</c>
/// already registers — so this seam starts EMPTY. Later foundation stories add their registrations here (outlets 03,
/// the publish funnel 04, the scheduler 05, alerts 10 ...), each guarded by its own <c>WebApplicationFactory&lt;Program&gt;</c>
/// wiring test; none of them edits <c>Program.cs</c>.
/// </remarks>
public static class ChannelsServiceCollectionExtensions
{
    /// <summary>Registers the channels foundation's services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddChannels(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Story 04: the content publish funnel (IContentPublishService), its sanitizer profiles and startup check.
        services.AddContentPublishFunnel();
        services.AddChannelAlerts(); // story 10: the alert source, IAlertRaiser and the expiry sweep
        return services;
    }

    /// <summary>
    /// Maps the channels foundation's routes, called once from <c>Program.cs</c> (the route twin of
    /// <see cref="AddChannels"/>): later foundation stories add their <c>Map*</c> calls here, not to <c>Program.cs</c>.
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapChannels(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapChannelAlerts(); // story 10: GET /api/alerts/history; POST /api/alerts, /api/alerts/{id}/clear
        return endpoints;
    }
}
