namespace Pulse.WebApi.Features.Channels;

using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Enablement;

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

        services.AddChannelEnablement(); // 08: IChannelEnablement behind RequireChannelEnabled (FC-7)
        return services;
    }
}
