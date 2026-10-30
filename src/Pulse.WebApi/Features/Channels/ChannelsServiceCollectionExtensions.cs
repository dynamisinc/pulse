namespace Pulse.WebApi.Features.Channels;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The channels foundation's one DI entry point (FC-9.10), called once from the orchestrator-owned <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// Story 01 shipped schema only — the channel entities live in <c>PulseDbContext</c>, which <c>AddPulsePersistence</c>
/// already registers. Later foundation stories add their registrations here (outlets 03, the publish funnel 04, the
/// scheduler 05, alerts 10 ...), each guarded by its own <c>WebApplicationFactory&lt;Program&gt;</c> wiring test; none of
/// them edits <c>Program.cs</c>. Every registration is a <c>TryAdd</c>, so the call is idempotent.
/// </para>
/// <para>
/// <b>Story 03 (outlets)</b> registers the public <see cref="ISkinOverridesValidator"/> (a pure singleton the portal
/// config API reuses), the defaults catalog, the interim channel gate and the scoped <see cref="OutletService"/>. The
/// service also needs what the host already wires: persistence + exercise scoping, <c>AddExerciseClock()</c>,
/// <c>AddStaffIdentity()</c> (the gate and the acting human), <c>AddExerciseConfiguration()</c> (the gate's
/// enabled-channel projection) and <c>AddMedia()</c> (the logo URL signer).
/// </para>
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

        // Story 03, the outlet registry.
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<ISkinOverridesValidator, SkinOverridesValidator>();
        services.TryAddSingleton<OutletDefaultsCatalog>();
        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddScoped<OutletChannelGate>();
        services.TryAddScoped<OutletService>();
        return services;
    }
}
