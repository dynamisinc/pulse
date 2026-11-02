namespace Pulse.WebApi.Features.Channels.Content.Read;

using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;

/// <summary>
/// The FC-7 <see cref="IInSimLinkResolver"/> (channels-foundation story 06, SOC-004, NWS-015): turns an in-sim content
/// permalink into link-card data for Social's link previews and <c>GET /api/link-previews</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>No outbound fetch, ever.</b> The path is parsed, never requested: only the exact host-relative shape
/// <c>/{channelId}/{outletSlug}/{contentSlug}</c> (what <see cref="ContentPermalinks"/> builds) is looked up, in the
/// ambient exercise scope. A scheme, host, query, fragment, encoded or traversal segment, any other path, a disabled
/// channel, and a draft, scheduled, retracted, soft-deleted, unknown or cross-exercise item all resolve to null.
/// </para>
/// <para>
/// <b>Channel gate.</b> The route is channel-agnostic (Social calls it), so the TARGET channel's enablement is checked
/// here with <see cref="IChannelEnablement"/>: a card for a disabled channel would be a link into an unreachable route.
/// Unlike <c>RequireChannelEnabled</c> there is NO staff bypass: a link card is participant-world data (it is embedded
/// in posts participants see), so it follows the participant rule even when a staff session asks.
/// </para>
/// </remarks>
public sealed class InSimLinkResolver : IInSimLinkResolver
{
    /// <summary>The longest path considered (three segments of at most 80 characters, plus separators).</summary>
    private const int MaxPathLength = 256;

    private readonly ContentReadService _reads;
    private readonly ParticipantContentProjector _projector;
    private readonly IChannelEnablement _enablement;

    /// <summary>Creates the resolver.</summary>
    /// <param name="reads">The participant read service (the permalink lookup).</param>
    /// <param name="projector">The participant projector.</param>
    /// <param name="enablement">The channel enablement gate.</param>
    public InSimLinkResolver(ContentReadService reads, ParticipantContentProjector projector, IChannelEnablement enablement)
    {
        ArgumentNullException.ThrowIfNull(reads);
        ArgumentNullException.ThrowIfNull(projector);
        ArgumentNullException.ThrowIfNull(enablement);
        _reads = reads;
        _projector = projector;
        _enablement = enablement;
    }

    /// <inheritdoc />
    public async Task<LinkPreviewDto?> ResolveAsync(string path, CancellationToken cancellationToken = default)
    {
        if (!TryParse(path, out var channelId, out var outletSlug, out var contentSlug)
            || !await _enablement.IsEnabledAsync(channelId, cancellationToken))
        {
            return null;
        }

        var found = await _reads.FindAsync(channelId, outletSlug, contentSlug, cancellationToken);
        if (found is not { } hit || hit.Item.Status != ChannelVocabulary.StatusPublished)
        {
            return null;
        }

        return await _projector.ToLinkPreviewAsync(hit.Item, hit.Outlet, cancellationToken);
    }

    /// <summary>
    /// Splits an exact permalink path. Each segment is validated against FC-1 (content channel id, slug pattern), which
    /// rules out schemes, hosts, queries, fragments, percent-encoding and <c>..</c> structurally.
    /// </summary>
    internal static bool TryParse(string? path, out string channelId, out string outletSlug, out string contentSlug)
    {
        channelId = outletSlug = contentSlug = string.Empty;
        if (string.IsNullOrEmpty(path) || path.Length > MaxPathLength || path[0] != '/')
        {
            return false;
        }

        var segments = path[1..].Split('/');
        if (segments.Length != 3
            || !ChannelVocabulary.ContentChannelIds.Contains(segments[0], StringComparer.Ordinal)
            || !ChannelVocabulary.IsSlug(segments[1])
            || !ChannelVocabulary.IsSlug(segments[2]))
        {
            return false;
        }

        (channelId, outletSlug, contentSlug) = (segments[0], segments[1], segments[2]);
        return true;
    }
}
