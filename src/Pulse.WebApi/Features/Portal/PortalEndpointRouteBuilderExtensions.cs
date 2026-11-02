namespace Pulse.WebApi.Features.Portal;

using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.Portal.Config;

/// <summary>
/// The exercise portal's one route entry point (E3, PC-4), called once from the orchestrator-owned <c>Program.cs</c> as
/// <c>app.MapPortal()</c>. Later portal backend stories (04 resources, 21 filler) add their <c>Map*</c> calls HERE.
/// </summary>
public static class PortalEndpointRouteBuilderExtensions
{
    /// <summary>Maps the exercise portal's routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPortal(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPortalConfig(); // story 03: GET /api/portal; GET|PUT /api/portal/config

        return endpoints;
    }
}
