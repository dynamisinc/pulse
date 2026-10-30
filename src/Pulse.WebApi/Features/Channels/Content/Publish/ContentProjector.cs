namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Media;

/// <summary>
/// Projects a <see cref="ContentItem"/> to the FC-3 shapes the funnel returns and broadcasts (channels-foundation story
/// 04): the staff view (<see cref="ChannelContentStaffDto"/>) for the caller, and the participant-safe frame payloads
/// (<see cref="ChannelContentSummaryDto"/>, <see cref="ContentRevisedDto"/>, <see cref="ContentRetractedDto"/>) for
/// <c>IFeedBroadcaster</c>. Story 06's participant read reuses it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Two worlds (XC-002).</b> Only <see cref="ToStaffAsync"/> reads staff-only columns. The participant shapes are built
/// field by field from participant-safe columns and carry only <c>update</c>/<c>correction</c> revisions; they never see
/// <c>origin</c>, <c>actingHumanId</c>, a wall clock, <c>version</c> or the staff payload.
/// </para>
/// <para>
/// <b>Scope.</b> Every read goes through the scoped <see cref="PulseDbContext"/> filter. The outlet is read including
/// soft-deleted rows (within the exercise) so an item filed under a since-deleted outlet still projects. Media URLs are
/// minted by <see cref="IMediaUrlSigner"/>; with no signer (a hand-built test) they are empty.
/// </para>
/// </remarks>
public sealed class ContentProjector
{
    private readonly PulseDbContext _db;
    private readonly IMediaUrlSigner? _signer;

    /// <summary>Creates the projector.</summary>
    /// <param name="db">The scoped context.</param>
    /// <param name="signer">Mints media read URLs; optional.</param>
    public ContentProjector(PulseDbContext db, IMediaUrlSigner? signer = null)
    {
        ArgumentNullException.ThrowIfNull(db);
        _db = db;
        _signer = signer;
    }

    /// <summary>A scenario/wall instant as the wire's ISO string.</summary>
    /// <param name="value">The instant.</param>
    /// <returns>The round-trip ("O") string.</returns>
    public static string Iso(DateTimeOffset value) => value.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>The staff view of <paramref name="item"/>.</summary>
    /// <param name="item">The item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staff DTO.</returns>
    public async Task<ChannelContentStaffDto> ToStaffAsync(ContentItem item, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);

        var outlet = await LoadOutletAsync(item, cancellationToken);
        var (hero, media) = await LoadMediaAsync(item, cancellationToken);
        var revisions = await LoadRevisionsAsync(item, cancellationToken);

        return new ChannelContentStaffDto
        {
            Id = item.Id.ToString(),
            ChannelId = item.ChannelId,
            Kind = item.Kind,
            Outlet = OutletRef(outlet),
            Slug = item.Slug,
            Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
            State = ChannelVocabulary.ParticipantContentStates.Contains(item.Status, StringComparer.Ordinal) ? item.Status : null,
            Headline = item.Headline,
            Dek = item.Dek,
            Kicker = item.Kicker,
            Category = item.Category,
            Hero = hero,
            PublishedScenarioTime = item.PublishedScenarioTime is { } published ? Iso(published) : null,
            UpdatedScenarioTime = item.UpdatedScenarioTime is { } updated ? Iso(updated) : null,
            Featured = item.FeaturedRank is not null,
            Byline = Byline(item),
            BodyHtml = item.BodyHtml,
            Media = media,
            Revisions = revisions.Where(r => r.Visible).Select(Revision).ToList(),
            PairedPostId = item.PairedPostId?.ToString(),
            AlertId = item.AlertId?.ToString(),
            Payload = ParsePayload(item.PayloadJson),
            Status = item.Status,
            Origin = item.Origin,
            ActingHumanId = item.ActingHumanId,
            ScheduledScenarioTime = item.ScheduledScenarioTime is { } scheduled ? Iso(scheduled) : null,
            PublishedWallClock = item.PublishedWallClock is { } wall ? Iso(wall) : null,
            Background = item.Background,
            FeaturedRank = item.FeaturedRank,
            InjectId = item.InjectId?.ToString(),
            ExternalSource = item.ExternalSource,
            ExternalRef = item.ExternalRef,
            RevisionCount = item.RevisionCount,
            RevisionLog = revisions.Select(Revision).ToList(),
            Version = item.Version,
        };
    }

    /// <summary>The participant-safe <c>ContentPublished</c> payload of a published item.</summary>
    /// <param name="item">A published item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The summary DTO.</returns>
    public async Task<ChannelContentSummaryDto> ToSummaryAsync(ContentItem item, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);

        var outlet = await LoadOutletAsync(item, cancellationToken);
        var (hero, _) = await LoadMediaAsync(item, cancellationToken);

        return new ChannelContentSummaryDto
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
            PublishedScenarioTime = Iso(item.PublishedScenarioTime
                ?? throw new InvalidOperationException("Only a published item has a ContentPublished summary.")),
            UpdatedScenarioTime = item.UpdatedScenarioTime is { } updated ? Iso(updated) : null,
            Featured = item.FeaturedRank is not null,
        };
    }

    /// <summary>The participant-safe <c>ContentRevised</c> payload (no body; clients refetch the item).</summary>
    /// <param name="item">The revised item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The frame payload.</returns>
    public async Task<ContentRevisedDto> ToRevisedAsync(ContentItem item, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);

        var outlet = await LoadOutletAsync(item, cancellationToken);
        var revisions = await LoadRevisionsAsync(item, cancellationToken);

        return new ContentRevisedDto
        {
            Id = item.Id.ToString(),
            ChannelId = item.ChannelId,
            Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
            UpdatedScenarioTime = item.UpdatedScenarioTime is { } updated ? Iso(updated) : null,
            Revisions = revisions.Where(r => r.Visible).Select(Revision).ToList(),
            Headline = item.Headline,
            Dek = item.Dek,
        };
    }

    /// <summary>The participant-safe <c>ContentRetracted</c> payload.</summary>
    /// <param name="item">The retracted (or deleted) item.</param>
    /// <param name="retractedScenarioTime">The scenario instant it left the participant world.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The frame payload.</returns>
    public async Task<ContentRetractedDto> ToRetractedAsync(
        ContentItem item, DateTimeOffset retractedScenarioTime, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);

        var outlet = await LoadOutletAsync(item, cancellationToken);
        return new ContentRetractedDto
        {
            Id = item.Id.ToString(),
            ChannelId = item.ChannelId,
            Permalink = ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug),
            RetractedScenarioTime = Iso(retractedScenarioTime),
        };
    }

    /// <summary>The item's host-relative permalink (FC-9.3).</summary>
    /// <param name="item">The item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The permalink path.</returns>
    public async Task<string> PermalinkAsync(ContentItem item, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        var outlet = await LoadOutletAsync(item, cancellationToken);
        return ContentPermalinks.Build(item.ChannelId, outlet.Slug, item.Slug);
    }

    private static OutletRefDto OutletRef(Outlet outlet) => new()
    {
        Id = outlet.Id.ToString(),
        ChannelId = outlet.ChannelId,
        Slug = outlet.Slug,
        Name = outlet.Name,
        SkinKey = outlet.SkinKey,
    };

    private static ContentBylineDto? Byline(ContentItem item) =>
        item.BylineName is null && item.BylinePersonaId is null
            ? null
            : new ContentBylineDto { Name = item.BylineName ?? string.Empty, PersonaId = item.BylinePersonaId?.ToString() };

    private static ContentRevisionDto Revision(ContentItemRevision revision) => new()
    {
        Number = revision.Number,
        Kind = revision.Kind,
        ScenarioTime = Iso(revision.ScenarioTime),
        Note = revision.Note,
    };

    private static JsonObject ParsePayload(string json)
    {
        try
        {
            return JsonNode.Parse(json) as JsonObject ?? [];
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }
    }

    private async Task<Outlet> LoadOutletAsync(ContentItem item, CancellationToken cancellationToken) =>
        await _db.IncludingSoftDeleted<Outlet>()
            .AsNoTracking()
            .FirstOrDefaultAsync(outlet => outlet.Id == item.OutletId, cancellationToken)
        ?? throw new InvalidOperationException($"Content item {item.Id} names an outlet outside its exercise.");

    private async Task<List<ContentItemRevision>> LoadRevisionsAsync(ContentItem item, CancellationToken cancellationToken) =>
        await _db.ContentItemRevisions
            .AsNoTracking()
            .Where(revision => revision.ContentItemId == item.Id)
            .OrderBy(revision => revision.Number)
            .ToListAsync(cancellationToken);

    private async Task<(ContentMediaDto? Hero, IReadOnlyList<ContentMediaDto> Media)> LoadMediaAsync(
        ContentItem item, CancellationToken cancellationToken)
    {
        var rows = await _db.ContentItemMedia
            .AsNoTracking()
            .Where(row => row.ContentItemId == item.Id)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var ids = rows.Select(row => row.MediaAssetId).ToHashSet();
        if (item.HeroMediaId is { } heroId)
        {
            ids.Add(heroId);
        }

        if (ids.Count == 0)
        {
            return (null, []);
        }

        var assets = await _db.MediaAssets
            .AsNoTracking()
            .Where(asset => ids.Contains(asset.Id))
            .ToDictionaryAsync(asset => asset.Id, cancellationToken);

        var posterIds = assets.Values
            .Where(asset => asset.PosterMediaAssetId is { } poster && !assets.ContainsKey(poster))
            .Select(asset => asset.PosterMediaAssetId!.Value)
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

        ContentMediaDto? Dto(Guid assetId, string role, string? alt) =>
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

        var media = rows
            .Select(row => Dto(row.MediaAssetId, row.Role, row.Alt))
            .OfType<ContentMediaDto>()
            .ToList();

        var hero = item.HeroMediaId is { } hid
            ? Dto(hid, ChannelVocabulary.MediaRoleHero, rows.FirstOrDefault(row => row.MediaAssetId == hid)?.Alt)
            : null;

        return (hero, media);
    }
}
