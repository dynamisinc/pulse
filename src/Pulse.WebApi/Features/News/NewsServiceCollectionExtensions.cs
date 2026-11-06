namespace Pulse.WebApi.Features.News;

using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The news channel's one DI entry point (news-network, E4), called once from the orchestrator-owned <c>Program.cs</c>.
/// E4 is frontend-heavy: story 01's descriptor and body profile are its only backend registrations, guarded by
/// <c>NewsCompositionRootWiringTests</c>.
/// </summary>
public static class NewsServiceCollectionExtensions
{
    /// <summary>Registers the news channel's services. Idempotent.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddNewsChannel(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Story 01: the article kind (FC-7). Scoped like every descriptor (its hero rule reads the exercise's media).
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IContentKindDescriptor, ArticleKindDescriptor>());

        // Story 01: the article-rich body profile (FU-8). The registry refuses a duplicate name, so register it once.
        var registered = services.Any(descriptor =>
            descriptor.ImplementationInstance is SanitizerProfileRegistration { Name: ArticleBodyProfile.Name });
        if (!registered)
        {
            services.AddSanitizerProfile(ArticleBodyProfile.Name, ArticleBodyProfile.Profile);
        }

        return services;
    }
}
