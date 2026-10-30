namespace Pulse.WebApi.Features.Channels;

using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Outlets;

/// <summary>
/// The channels foundation's one route entry point (FC-9.10), called once from the orchestrator-owned
/// <c>Program.cs</c> as <c>app.MapChannels()</c>.
/// </summary>
/// <remarks>
/// Story 03 maps the outlet registry (<c>/api/outlets*</c>); story 10 the alert history and staff alert routes. Later
/// foundation stories (the content API, link previews ...) add their <c>Map*</c> calls HERE, each guarded by its own <c>WebApplicationFactory&lt;Program&gt;</c>
/// wiring test; none of them edits <c>Program.cs</c>.
/// </remarks>
public static class ChannelsEndpointRouteBuilderExtensions
{
    /// <summary>Maps the channels foundation's routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapChannels(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapOutlets(); // story 03: /api/outlets*
        endpoints.MapChannelAlerts(); // story 10: GET /api/alerts/history; POST /api/alerts, /api/alerts/{id}/clear

        return endpoints;
    }
}
