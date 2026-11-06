namespace Pulse.WebApi.Features.Channels.Content.Read;

using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Media;

/// <summary>
/// The participant (XC-002) projector of the channels read path (channels-foundation story 06): the ONLY place a
/// <see cref="ChannelContentDto"/> or <see cref="ChannelContentTombstoneDto"/> is built (the <c>ParticipantPostProjector</c>
/// rule), plus the list rows and the link-card data the in-sim resolver returns.
/// </summary>
/// <remarks>
/// <para>
/// <b>Field by field from participant-safe columns.</b> Nothing here reads <c>Origin</c>, <c>ActingHumanId</c>, a wall
/// clock, <c>Status</c>, <c>Background</c>, <c>FeaturedRank</c> (beyond "is featured"), <c>Version</c>, <c>InjectId</c>,
/// <c>ExternalSource</c>/<c>ExternalRef</c>, <c>PublishOptionsJson</c> or <c>LastError</c>. Revisions are filtered twice:
/// the stored <c>Visible</c> flag AND <see cref="ChannelVocabulary.ParticipantRevisionKinds"/>, so an <c>edit</c> or a
/// <c>silent_rewrite</c> never reaches <c>revisions[]</c> even if a row were mis-flagged (news FU-1).
/// </para>
/// <para>
/// <b>Payload.</b> The stored payload reaches a participant only through the kind's
/// <see cref="IContentKindDescriptor.ProjectPayload"/>. A kind with no registered descriptor projects to <c>{}</c>:
/// fail closed, never the raw staff payload.
/// </para>
/// <para>
/// <b>Batched.</b> The list projects a whole page with one media-row read, one asset read and one signer call (list
/// rows carry no revisions), so a page of 50 is a constant number of queries. Callers hand in the outlets they already resolved (enabled, in scope).
/// </para>
/// </remarks>
public sealed class ParticipantContentProjector
{
    private readonly PulseDbContext _db;
    private readonly IReadOnlyList<IContentKindDescriptor> _descriptors;
    private readonly IMediaUrlSigner? _signer;

    /// <summary>Creates the projector.</summary>
    /// <param name="db">The scoped context.</param>
    /// <param name="descriptors">The registered content kinds (their <c>ProjectPayload</c>).</param>
    /// <param name="signer">Mints media read URLs; optional (a hand-built test).</param>
    public ParticipantContentProjector(
        PulseDbContext db,
        IEnumerable<IContentKindDescriptor> descriptors,
        IMediaUrlSigner? signer = null)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(descriptors);
        _db = db;
        _descriptors = descriptors.ToList();
        _signer = signer;
    }

    /// <summary>Projects a page of PUBLISHED items to list rows, preserving order.</summary>
    /// <param name="items">The published items.</param>
    /// <param name="outlets">Their (enabled, in-scope) outlets by id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The rows.</returns>
    public async Task<IReadOnlyList<ChannelContentSummaryDto>> ToSummariesAsync(
        IReadOnlyList<ContentItem> items,
        IReadOnlyDictionary<Guid, Outlet> outlets,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(outlets);
        if (items.Count == 0)
        {
            return [];
        }

        var media = await LoadMediaAsync(items, cancellationToken);
        return items.Select(item => Summary(item, outlets[item.OutletId], media.Hero(item))).ToList();
    }

    /// <summary>The permalink read of a PUBLISHED item.</summary>
    /// <param name="item">The published item.</param>
    /// <param name="outlet">Its (enabled, in-scope) outlet.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The participant DTO.</returns>
    public async Task<ChannelContentDto> ToContentAsync(ContentItem item, Outlet outlet, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(outlet);

        var media = await LoadMediaAsync([item], cancellationToken);
        var revisions = await _db.ContentItemRevisions
            .AsNoTracking()
            .Where(revision => revision.ContentItemId == item.Id
                && revision.Visible
                && ChannelVocabulary.ParticipantRevisionKinds.Contains(revision.Kind))
            .OrderBy(revision => revision.Number)
            .ToListAsync(cancellationToken);

        return new ChannelContentDto
        {
            Id = item.Id.ToString(),
            ChannelId = item.ChannelId,
            Kind = item.Kind,
            Outlet = OutletRef(outlet),
            Slug = item.Slug,
            Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
            Headline = item.Headline,
            Dek = item.Dek,
            Kicker = item.Kicker,
            Category = item.Category,
            Hero = media.Hero(item),
            PublishedScenarioTime = PublishedAt(item),
            UpdatedScenarioTime = item.UpdatedScenarioTime is { } updated ? ContentProjector.Iso(updated) : null,
            Featured = item.FeaturedRank is not null,
            Byline = item.BylineName is null && item.BylinePersonaId is null
                ? null
                : new ContentBylineDto { Name = item.BylineName ?? string.Empty, PersonaId = item.BylinePersonaId?.ToString() },
            BodyHtml = item.BodyHtml,
            Media = media.Inline(item),
            Revisions = revisions.Select(revision => new ContentRevisionDto
            {
                Number = revision.Number,
                Kind = revision.Kind,
                ScenarioTime = ContentProjector.Iso(revision.ScenarioTime),
                Note = revision.Note,
            }).ToList(),
            PairedPostId = item.PairedPostId?.ToString(),
            AlertId = item.AlertId?.ToString(),
            Payload = ProjectPayload(item),
        };
    }

    /// <summary>The XC-010 tombstone of a RETRACTED item: identity and the retraction instant only.</summary>
    /// <param name="item">The retracted item.</param>
    /// <param name="outlet">Its (enabled, in-scope) outlet.</param>
    /// <returns>The tombstone.</returns>
    public static ChannelContentTombstoneDto ToTombstone(ContentItem item, Outlet outlet)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(outlet);

        return new ChannelContentTombstoneDto
        {
            Id = item.Id.ToString(),
            ChannelId = item.ChannelId,
            Kind = item.Kind,
            Outlet = OutletRef(outlet),
            Slug = item.Slug,
            Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
            RetractedScenarioTime = ContentProjector.Iso(item.RetractedScenarioTime
                ?? item.UpdatedScenarioTime
                ?? item.PublishedScenarioTime
                ?? item.CreatedScenarioTime),
        };
    }

    /// <summary>The in-sim link card of a PUBLISHED item (SOC-004).</summary>
    /// <param name="item">The published item.</param>
    /// <param name="outlet">Its (enabled, in-scope) outlet.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The card.</returns>
    public async Task<LinkPreviewDto> ToLinkPreviewAsync(ContentItem item, Outlet outlet, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(outlet);

        var media = await LoadMediaAsync([item], cancellationToken);
        return new LinkPreviewDto
        {
            Title = item.Headline,
            Description = item.Dek,
            Image = media.Hero(item),
            SourceName = outlet.Name,
            Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
        };
    }

    private static ChannelContentSummaryDto Summary(ContentItem item, Outlet outlet, ContentMediaDto? hero) => new()
    {
        Id = item.Id.ToString(),
        ChannelId = item.ChannelId,
        Kind = item.Kind,
        Outlet = OutletRef(outlet),
        Slug = item.Slug,
        Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
        Headline = item.Headline,
        Dek = item.Dek,
        Kicker = item.Kicker,
        Category = item.Category,
        Hero = hero,
        PublishedScenarioTime = PublishedAt(item),
        UpdatedScenarioTime = item.UpdatedScenarioTime is { } updated ? ContentProjector.Iso(updated) : null,
        Featured = item.FeaturedRank is not null,
    };

    private static OutletRefDto OutletRef(Outlet outlet) => new()
    {
        Id = outlet.Id.ToString(),
        ChannelId = outlet.ChannelId,
        Slug = outlet.Slug,
        Name = outlet.Name,
        SkinKey = outlet.SkinKey,
    };

    private static string PublishedAt(ContentItem item) => ContentProjector.Iso(item.PublishedScenarioTime
        ?? throw new InvalidOperationException($"Content item {item.Id} is published without a publish instant."));

    private JsonObject ProjectPayload(ContentItem item)
    {
        var descriptor = _descriptors.FirstOrDefault(d =>
            string.Equals(d.Kind, item.Kind, StringComparison.Ordinal)
            && string.Equals(d.ChannelId, item.ChannelId, StringComparison.Ordinal));
        if (descriptor is null)
        {
            return [];
        }

        JsonObject stored;
        try
        {
            stored = JsonNode.Parse(item.PayloadJson) as JsonObject ?? [];
        }
        catch (System.Text.Json.JsonException)
        {
            stored = [];
        }

        // Deep-clone the projection: a descriptor returning (part of) its input must not tie the DTO to a parsed tree
        // anything else holds.
        return descriptor.ProjectPayload(stored).DeepClone() as JsonObject ?? [];
    }

    private async Task<MediaSet> LoadMediaAsync(IReadOnlyCollection<ContentItem> items, CancellationToken cancellationToken)
    {
        var itemIds = items.Select(item => item.Id).ToList();
        var rows = await _db.ContentItemMedia
            .AsNoTracking()
            .Where(row => itemIds.Contains(row.ContentItemId))
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var ids = rows.Select(row => row.MediaAssetId).ToHashSet();
        foreach (var item in items)
        {
            if (item.HeroMediaId is { } heroId)
            {
                ids.Add(heroId);
            }
        }

        if (ids.Count == 0)
        {
            return MediaSet.Empty;
        }

        var assets = await _db.MediaAssets
            .AsNoTracking()
            .Where(asset => ids.Contains(asset.Id))
            .ToDictionaryAsync(asset => asset.Id, cancellationToken);

        var posterIds = assets.Values
            .Where(asset => asset.PosterMediaAssetId is { } poster && !assets.ContainsKey(poster))
            .Select(asset => asset.PosterMediaAssetId!.Value)
            .Distinct()
            .ToList();
        if (posterIds.Count > 0)
        {
            foreach (var poster in await _db.MediaAssets.AsNoTracking()
                         .Where(asset => posterIds.Contains(asset.Id)).ToListAsync(cancellationToken))
            {
                assets[poster.Id] = poster;
            }
        }

        var urls = _signer is null
            ? new Dictionary<Guid, string>()
            : await _signer.GetReadUrlsAsync(assets.Values.ToList(), cancellationToken);

        return new MediaSet(rows.ToLookup(row => row.ContentItemId), assets, urls);
    }

    /// <summary>One page's media rows, assets and signed URLs.</summary>
    private sealed class MediaSet(
        ILookup<Guid, ContentItemMedia> rows,
        IReadOnlyDictionary<Guid, MediaAsset> assets,
        IReadOnlyDictionary<Guid, string> urls)
    {
        public static MediaSet Empty { get; } = new(
            Array.Empty<ContentItemMedia>().ToLookup(row => row.ContentItemId),
            new Dictionary<Guid, MediaAsset>(),
            new Dictionary<Guid, string>());

        public ContentMediaDto? Hero(ContentItem item) =>
            item.HeroMediaId is { } heroId
                ? Dto(heroId, ChannelVocabulary.MediaRoleHero, rows[item.Id].FirstOrDefault(row => row.MediaAssetId == heroId)?.Alt)
                : null;

        public List<ContentMediaDto> Inline(ContentItem item) =>
            rows[item.Id]
                .Where(row => !string.Equals(row.Role, ChannelVocabulary.MediaRoleHero, StringComparison.Ordinal))
                .Select(row => Dto(row.MediaAssetId, row.Role, row.Alt))
                .OfType<ContentMediaDto>()
                .ToList();

        private ContentMediaDto? Dto(Guid assetId, string role, string? alt) =>
            assets.TryGetValue(assetId, out var asset)
                ? new ContentMediaDto
                {
                    Id = asset.Id.ToString(),
                    Kind = asset.Kind,
                    Role = role,
                    Url = urls.TryGetValue(asset.Id, out var url) ? url : string.Empty,
                    PosterUrl = asset.PosterMediaAssetId is { } poster && urls.TryGetValue(poster, out var posterUrl)
                        ? posterUrl
                        : null,
                    ContentType = asset.ContentType,
                    Width = asset.Width,
                    Height = asset.Height,
                    DurationSec = asset.DurationSec,
                    Alt = alt ?? string.Empty,
                }
                : null;
    }
}
