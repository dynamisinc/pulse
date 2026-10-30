namespace Pulse.WebApi.Features.Channels.Content.Publish;

using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Fails host start when the registered content kinds are inconsistent (channels-foundation story 04; news FU-8,
/// press FU-5): a descriptor naming an unregistered <see cref="IContentKindDescriptor.BodyPolicy"/>, a kind registered
/// twice, or a kind filed under a channel that owns no content. Better a deploy that refuses to start than a body
/// sanitized by the wrong profile.
/// </summary>
/// <remarks>
/// Descriptors are scoped (they may read the exercise's data), so the check resolves them in a throwaway scope. Building
/// a descriptor touches no database: the scoped <c>PulseDbContext</c> is constructed, never queried.
/// </remarks>
public sealed class ContentKindStartupCheck : IHostedService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ISanitizerProfileRegistry _profiles;

    /// <summary>Creates the check.</summary>
    /// <param name="scopeFactory">Creates the scope the descriptors are resolved in.</param>
    /// <param name="profiles">The sanitizer profile registry.</param>
    public ContentKindStartupCheck(IServiceScopeFactory scopeFactory, ISanitizerProfileRegistry profiles)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(profiles);

        _scopeFactory = scopeFactory;
        _profiles = profiles;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        Validate(scope.ServiceProvider.GetServices<IContentKindDescriptor>(), _profiles);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>Throws <see cref="InvalidOperationException"/> naming the first inconsistency.</summary>
    /// <param name="descriptors">The registered descriptors.</param>
    /// <param name="profiles">The sanitizer profile registry.</param>
    public static void Validate(IEnumerable<IContentKindDescriptor> descriptors, ISanitizerProfileRegistry profiles)
    {
        ArgumentNullException.ThrowIfNull(descriptors);
        ArgumentNullException.ThrowIfNull(profiles);

        var kinds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var descriptor in descriptors)
        {
            if (string.IsNullOrWhiteSpace(descriptor.Kind) || !kinds.Add(descriptor.Kind))
            {
                throw new InvalidOperationException(
                    $"Content kind '{descriptor.Kind}' is registered more than once (or is empty); each kind has one descriptor.");
            }

            if (!ChannelVocabulary.ContentChannelIds.Contains(descriptor.ChannelId, StringComparer.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Content kind '{descriptor.Kind}' names channel '{descriptor.ChannelId}', which owns no content.");
            }

            if (!profiles.Contains(descriptor.BodyPolicy))
            {
                throw new InvalidOperationException(
                    $"Content kind '{descriptor.Kind}' names the sanitizer profile '{descriptor.BodyPolicy}', which is not registered.");
            }
        }
    }
}
