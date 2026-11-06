namespace Pulse.WebApi.Features.Portal;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Portal.Config;
using Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// The exercise portal's one DI entry point (E3), called once from the orchestrator-owned <c>Program.cs</c> as
/// <c>builder.Services.AddPortal()</c>. Later portal backend stories (04 resources, 21 filler) add their registrations
/// HERE, each guarded by the portal composition-root wiring test; none of them edits <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// Story 03 (config) needs what <c>AddChannels()</c> already registers: <c>IChannelEnablement</c> (F08), the public
/// <c>ISkinOverridesValidator</c> (F03) and <c>ExerciseFactsReader</c>; and what the host wires: persistence + exercise
/// scoping, <c>AddExerciseClock()</c>, <c>AddStaffIdentity()</c> and <c>AddMedia()</c> (the logo URL signer). Every
/// registration is a <c>TryAdd</c>, so the call is idempotent.
/// </remarks>
public static class PortalServiceCollectionExtensions
{
    /// <summary>Registers the exercise portal's services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPortal(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<IPortalConfigService, PortalConfigService>(); // 03: GET /api/portal, GET|PUT /api/portal/config

        return services;
    }
}
