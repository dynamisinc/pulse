namespace Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-7, builds content permalinks. A permalink is ALWAYS the host-relative path
/// <c>/{channelId}/{outletSlug}/{contentSlug}</c> and never carries a scheme or host (FC-9.3, COR-008,
/// PDF-11): browsers resolve it against whichever exercise host serves the page. The client twin is
/// <c>contentPermalink()</c> in <c>features/channels/contract/permalink.ts</c>.
/// </summary>
public interface IContentPermalinks
{
    /// <summary>Builds the permalink for a content item.</summary>
    /// <param name="channelId">A content channel id (<see cref="ChannelVocabulary.ContentChannelIds"/>).</param>
    /// <param name="outletSlug">The outlet slug (<see cref="ChannelVocabulary.IsSlug"/>).</param>
    /// <param name="contentSlug">The content slug (<see cref="ChannelVocabulary.IsSlug"/>).</param>
    /// <returns>The host-relative path.</returns>
    /// <exception cref="ArgumentException">A segment is not a content channel id or a valid slug.</exception>
    [System.Diagnostics.CodeAnalysis.SuppressMessage(
        "Naming",
        "CA1716:Identifiers should not match keywords",
        Justification = "FC-7 freezes the name IContentPermalinks.For; downstream stories call it by that name.")]
    string For(string channelId, string outletSlug, string contentSlug);
}

/// <summary>
/// The one <see cref="IContentPermalinks"/> implementation: a pure function, so it lives with the contract.
/// Every segment is validated against FC-1 before it is joined, which is what makes a host, a scheme, a
/// query or a traversal segment structurally impossible in the output.
/// </summary>
public sealed class ContentPermalinks : IContentPermalinks
{
    /// <summary>A shared instance (the type is stateless).</summary>
    public static ContentPermalinks Instance { get; } = new();

    /// <inheritdoc />
    public string For(string channelId, string outletSlug, string contentSlug) => Build(channelId, outletSlug, contentSlug);

    /// <summary>Static form of <see cref="For"/>, for mappers that do not take the interface.</summary>
    /// <param name="channelId">A content channel id.</param>
    /// <param name="outletSlug">The outlet slug.</param>
    /// <param name="contentSlug">The content slug.</param>
    /// <returns>The host-relative path.</returns>
    public static string Build(string channelId, string outletSlug, string contentSlug)
    {
        if (channelId is null || !ChannelVocabulary.ContentChannelIds.Contains(channelId, StringComparer.Ordinal))
        {
            throw new ArgumentException($"'{channelId}' is not a content channel id.", nameof(channelId));
        }

        if (!ChannelVocabulary.IsSlug(outletSlug))
        {
            throw new ArgumentException($"'{outletSlug}' is not a valid outlet slug.", nameof(outletSlug));
        }

        if (!ChannelVocabulary.IsSlug(contentSlug))
        {
            throw new ArgumentException($"'{contentSlug}' is not a valid content slug.", nameof(contentSlug));
        }

        return $"/{channelId}/{outletSlug}/{contentSlug}";
    }
}
