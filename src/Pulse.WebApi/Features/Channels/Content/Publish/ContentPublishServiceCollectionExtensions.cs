namespace Pulse.WebApi.Features.Channels.Content.Publish;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// DI for the publish funnel (channels-foundation story 04), called from the orchestrator-owned
/// <c>AddChannels()</c> seam. Idempotent (every registration is a <c>TryAdd</c>).
/// </summary>
/// <remarks>
/// Registers the funnel (<see cref="IContentPublishService"/>, scoped), its projector, the singleton
/// <see cref="ISanitizerProfileRegistry"/>, <see cref="IContentPermalinks"/> and the <see cref="ContentKindStartupCheck"/>.
/// It registers NO gate, observer, alert raiser or paired poster: none means pass-through / nothing to tell / reported as a
/// side-effect warning. Channels add theirs with plain <c>AddScoped&lt;IContentPublishGate, ...&gt;()</c> (evaluated in
/// registration order), <c>AddScoped&lt;IContentPublishedObserver, ...&gt;()</c>, their <c>IContentKindDescriptor</c>, and
/// any extra body profile with <see cref="AddSanitizerProfile"/>.
/// </remarks>
public static class ContentPublishServiceCollectionExtensions
{
    /// <summary>Registers the publish funnel.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddContentPublishFunnel(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<ISanitizerProfileRegistry, SanitizerProfileRegistry>();
        services.TryAddSingleton<IContentPermalinks>(ContentPermalinks.Instance);
        services.TryAddScoped<ContentProjector>();
        services.TryAddScoped<IContentPublishService, ContentPublishService>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, ContentKindStartupCheck>());
        return services;
    }

    /// <summary>
    /// Registers an ADDITIONAL named body profile (news <c>article-rich</c>) at DI time. The registry refuses a
    /// script-capable profile or a duplicate name when it is first built (host start).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="name">The profile name a descriptor's <c>BodyPolicy</c> refers to.</param>
    /// <param name="profile">The allowlist.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSanitizerProfile(this IServiceCollection services, string name, SanitizerProfile profile)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(profile);

        services.AddSingleton(new SanitizerProfileRegistration(name, profile));
        return services;
    }
}
