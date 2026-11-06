namespace Pulse.WebApi.Features.Channels.Enablement;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// DI registration and the <c>RequireChannelEnabled</c> convention for the channel enablement gate (channels-foundation
/// 08, FC-7). Registration rides <c>AddChannels()</c>; no <c>Program.cs</c> edit.
/// </summary>
public static class ChannelEnablementExtensions
{
    /// <summary>Registers <see cref="IChannelEnablement"/> (scoped, matching the request-scoped persistence it reads).</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddChannelEnablement(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<IChannelEnablement, ChannelEnablement>();
        return services;
    }

    /// <summary>
    /// Gates every endpoint under <paramref name="builder"/> (an endpoint or a route group) on
    /// <paramref name="channelId"/> being enabled for the resolved exercise: a participant gets the same 404 as an
    /// unknown route when it is not; a staff session always passes. Channel stories wrap their participant routes in
    /// it (FC-4); Social is deliberately not gated (Q4).
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type.</typeparam>
    /// <param name="builder">The endpoint or group to gate.</param>
    /// <param name="channelId">A <see cref="ChannelCatalog"/> id, canonical casing.</param>
    /// <returns>The same builder, for chaining.</returns>
    /// <exception cref="ArgumentException">The id is not catalogued (a mapping-time failure, never a silent pass).</exception>
    public static TBuilder RequireChannelEnabled<TBuilder>(this TBuilder builder, string channelId)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        if (!ChannelCatalog.IsCatalogued(channelId))
        {
            throw new ArgumentException(
                $"'{channelId}' is not a catalogued channel id. Known ids: {string.Join(", ", ChannelCatalog.All.Select(c => c.Id))}.",
                nameof(channelId));
        }

        return builder.AddEndpointFilter(new ChannelEnablementEndpointFilter(channelId));
    }
}
