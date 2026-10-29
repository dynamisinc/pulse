namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Social;

// The write half of the funnel: validating and sanitizing a ContentWriteRequest, slugs, media rows and revision
// snapshots. Nothing here saves; the lifecycle methods in ContentPublishService.cs decide when the unit of work commits.
public sealed partial class ContentPublishService
{
    /// <summary>The longest RAW body accepted, checked before the sanitizer runs (a DoS bound for every caller).</summary>
    public const int MaxRawBodyLength = 400_000;

    /// <summary>The longest stored payload, in characters of JSON.</summary>
    public const int MaxPayloadLength = 64_000;

    /// <summary>The most media rows one item may carry.</summary>
    public const int MaxMediaPerItem = 20;

    /// <summary>
    /// The ONE message for any media id that does not resolve: unparseable, unknown, in another exercise, or (for a
    /// participant) uploaded by someone else — so the response never confirms that such an asset exists (COR-001).
    /// </summary>
    public const string MediaNotFoundMessage = "One or more media items could not be found.";

    private const int SlugSuffixRoom = 10;

    private static readonly JsonSerializerOptions SnapshotOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Resolves a live outlet of the descriptor's channel in the current exercise, or null.</summary>
    private async Task<Outlet?> ResolveOutletAsync(string? outletId, IContentKindDescriptor descriptor, CancellationToken cancellationToken)
    {
        if (!TryParseId(outletId, out var id))
        {
            return null;
        }

        return await _db.Outlets
            .AsNoTracking()
            .FirstOrDefaultAsync(outlet => outlet.Id == id && outlet.ChannelId == descriptor.ChannelId, cancellationToken);
    }

    private static string OutletMessage(IContentKindDescriptor descriptor) =>
        $"outletId does not name a {descriptor.ChannelId} outlet in this exercise.";

    /// <summary>
    /// Validates and sanitizes the writable fields (NFR-004). Text fields are stripped with <see cref="PostSanitizer"/>
    /// (they render as text); the body is sanitized once with the kind's NAMED profile; media must be in-scope assets the
    /// kind allows; the payload goes through the kind's <c>ValidatePayloadAsync</c> with an exercise-scoped context.
    /// Staff-only fields are kept as they are for a participant caller (never settable from a participant composer).
    /// </summary>
    private async Task<Preparation> PrepareAsync(
        ContentWriteRequest request,
        IContentKindDescriptor descriptor,
        ContentCaller caller,
        ContentItem? existing,
        string targetStatus,
        Guid exerciseId,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();

        var headline = Text(request.Headline, ContentItem.MaxHeadlineLength, "headline", errors, required: true);
        var dek = Text(request.Dek, ContentItem.MaxDekLength, "dek", errors);
        var kicker = Text(request.Kicker, ContentItem.MaxLabelLength, "kicker", errors);
        var category = Text(request.Category, ContentItem.MaxLabelLength, "category", errors);
        var bylineName = Text(request.BylineName, ContentItem.MaxBylineNameLength, "bylineName", errors);

        var rawBody = request.BodyHtml ?? string.Empty;
        var body = string.Empty;
        if (rawBody.Length > MaxRawBodyLength)
        {
            errors.Add($"bodyHtml must be at most {MaxRawBodyLength} characters.");
        }
        else
        {
            body = _profiles.Sanitize(descriptor.BodyPolicy, rawBody);
        }

        Guid? bylinePersonaId = null;
        if (!string.IsNullOrEmpty(request.BylinePersonaId))
        {
            if (TryParseId(request.BylinePersonaId, out var personaId)
                && await _db.Personas.AsNoTracking().AnyAsync(
                    persona => persona.Id == personaId && persona.ExerciseId == exerciseId, cancellationToken))
            {
                bylinePersonaId = personaId;
            }
            else
            {
                errors.Add("bylinePersonaId does not name a persona in this exercise.");
            }
        }

        var (heroMediaId, media) = await ResolveMediaAsync(request, descriptor, caller, exerciseId, errors, cancellationToken);

        bool background;
        int? featuredRank;
        string? externalSource;
        string? externalRef;
        if (caller.Origin == ChannelVocabulary.OriginParticipant)
        {
            background = existing?.Background ?? false;
            featuredRank = existing?.FeaturedRank;
            externalSource = existing?.ExternalSource;
            externalRef = existing?.ExternalRef;
        }
        else
        {
            background = request.Background;
            featuredRank = request.FeaturedRank;
            externalSource = string.IsNullOrWhiteSpace(request.ExternalSource) ? null : request.ExternalSource.Trim();
            externalRef = string.IsNullOrWhiteSpace(request.ExternalRef) ? null : request.ExternalRef.Trim();

            if (featuredRank is < 1)
            {
                errors.Add("featuredRank must be 1 or more.");
            }

            await ValidateExternalReferenceAsync(externalSource, externalRef, existing?.Id, errors, cancellationToken);
        }

        // The descriptor validates a private copy: a validator can never alias the caller's request object.
        var payload = request.Payload?.DeepClone() as JsonObject ?? [];
        var validation = await descriptor.ValidatePayloadAsync(
            payload,
            new PayloadValidationContext
            {
                ExerciseId = exerciseId,
                Db = _db,
                Services = _services,
                ContentItemId = existing?.Id,
                TargetStatus = targetStatus,
            },
            cancellationToken);
        errors.AddRange(validation.Errors);

        var payloadJson = payload.ToJsonString();
        if (payloadJson.Length > MaxPayloadLength)
        {
            errors.Add($"payload must be at most {MaxPayloadLength} characters of JSON.");
        }

        if (errors.Count > 0)
        {
            return new Preparation(null, errors);
        }

        return new Preparation(
            new PreparedFields(
                headline!, dek, kicker, category, bylineName, bylinePersonaId, body, heroMediaId, payloadJson, media,
                background, featuredRank, externalSource, externalRef),
            errors);
    }

    /// <summary>A plain-text field: bounded raw, stripped, trimmed, bounded stored; empty is null (or an error when required).</summary>
    private static string? Text(string? raw, int maxLength, string field, List<string> errors, bool required = false)
    {
        if (raw is { } value && value.Length > 4 * maxLength)
        {
            errors.Add($"{field} must be at most {maxLength} characters.");
            return null;
        }

        var text = PostSanitizer.Sanitize(raw ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            if (required)
            {
                errors.Add($"{field} is required.");
            }

            return null;
        }

        if (text.Length > maxLength)
        {
            errors.Add($"{field} must be at most {maxLength} characters.");
            return null;
        }

        return text;
    }

    /// <summary>The editor's note on an <c>update</c>/<c>correction</c>: stripped and bounded; empty is no note.</summary>
    private static string? WhyNoteInvalid(string? raw, out string? note)
    {
        var errors = new List<string>();
        note = Text(raw, ContentItemRevision.MaxNoteLength, "note", errors);
        return errors.Count > 0 ? errors[0] : null;
    }

    private async Task ValidateExternalReferenceAsync(
        string? source, string? reference, Guid? itemId, List<string> errors, CancellationToken cancellationToken)
    {
        if (source is null && reference is null)
        {
            return;
        }

        if (source is null || reference is null)
        {
            errors.Add("externalSource and externalRef are set together or not at all.");
            return;
        }

        if (source.Length > ContentItem.MaxExternalSourceLength || reference.Length > ContentItem.MaxExternalRefLength)
        {
            errors.Add("externalSource or externalRef is too long.");
            return;
        }

        // The unique index covers soft-deleted rows too, so the pre-check does as well (within this exercise only).
        var taken = await _db.IncludingSoftDeleted<ContentItem>()
            .AsNoTracking()
            .AnyAsync(
                item => item.ExternalSource == source && item.ExternalRef == reference && item.Id != (itemId ?? Guid.Empty),
                cancellationToken);
        if (taken)
        {
            errors.Add("externalRef is already used by another item in this exercise.");
        }
    }

    /// <summary>
    /// Validates the hero and the media list against the CALLER's exercise (one scoped read), the participant ownership
    /// rule shared with posts, and the kind's <see cref="IContentKindDescriptor.AllowedMediaKinds"/>.
    /// </summary>
    private async Task<(Guid? Hero, IReadOnlyList<PreparedMedia> Media)> ResolveMediaAsync(
        ContentWriteRequest request,
        IContentKindDescriptor descriptor,
        ContentCaller caller,
        Guid exerciseId,
        List<string> errors,
        CancellationToken cancellationToken)
    {
        var requested = request.Media ?? [];
        if (requested.Count > MaxMediaPerItem)
        {
            errors.Add($"An item may carry at most {MaxMediaPerItem} media items.");
            return (null, []);
        }

        var notFound = false;
        var media = new List<PreparedMedia>(requested.Count);
        foreach (var entry in requested)
        {
            if (entry is null || !TryParseId(entry.MediaId, out var assetId))
            {
                notFound = true;
                continue;
            }

            if (!ChannelVocabulary.MediaRoles.Contains(entry.Role, StringComparer.Ordinal))
            {
                errors.Add("media role must be one of hero, inline, attachment.");
                continue;
            }

            var alt = Text(entry.Alt, ContentItemMedia.MaxAltLength, "alt", errors);
            media.Add(new PreparedMedia(assetId, entry.Role, alt));
        }

        if (media.DistinctBy(item => item.AssetId).Count() != media.Count)
        {
            errors.Add("The same mediaId cannot be attached twice.");
        }

        Guid? heroId = null;
        if (!string.IsNullOrEmpty(request.HeroMediaId))
        {
            if (TryParseId(request.HeroMediaId, out var parsedHero))
            {
                heroId = parsedHero;
            }
            else
            {
                notFound = true;
            }
        }

        var ids = media.Select(item => item.AssetId).ToHashSet();
        if (heroId is { } hero)
        {
            ids.Add(hero);
        }

        var assets = ids.Count == 0
            ? []
            : await _db.MediaAssets
                .AsNoTracking()
                .Where(asset => ids.Contains(asset.Id) && asset.ExerciseId == exerciseId)
                .ToDictionaryAsync(asset => asset.Id, cancellationToken);

        var participant = caller.Origin == ChannelVocabulary.OriginParticipant;
        foreach (var id in ids)
        {
            // A participant may attach only their OWN uploads; same message as unknown, so nothing is confirmed.
            if (!assets.TryGetValue(id, out var asset)
                || (participant && !string.Equals(asset.UploadedByHumanId, caller.ActingHumanId, StringComparison.Ordinal)))
            {
                notFound = true;
            }
        }

        if (notFound)
        {
            errors.Add(MediaNotFoundMessage);
            return (null, []);
        }

        foreach (var item in media)
        {
            var kind = assets[item.AssetId].Kind;
            if (!descriptor.AllowedMediaKinds.Contains(kind))
            {
                errors.Add($"A {descriptor.Kind} cannot attach {kind} media.");
            }
            else if (kind is MediaKinds.Image or MediaKinds.Video && item.Alt is null)
            {
                errors.Add("alt text is required on every image and video.");
            }
        }

        if (heroId is { } heroAsset)
        {
            var kind = assets[heroAsset].Kind;
            if (kind is not (MediaKinds.Image or MediaKinds.Video) || !descriptor.AllowedMediaKinds.Contains(kind))
            {
                errors.Add($"heroMediaId must name an image or video a {descriptor.Kind} may carry.");
            }
        }

        return (heroId, media);
    }

    private static void ApplyFields(ContentItem item, PreparedFields fields)
    {
        item.Headline = fields.Headline;
        item.Dek = fields.Dek;
        item.Kicker = fields.Kicker;
        item.Category = fields.Category;
        item.BylineName = fields.BylineName;
        item.BylinePersonaId = fields.BylinePersonaId;
        item.BodyHtml = fields.BodyHtml;
        item.HeroMediaId = fields.HeroMediaId;
        item.PayloadJson = fields.PayloadJson;
        item.Background = fields.Background;
        item.FeaturedRank = fields.FeaturedRank;
        item.ExternalSource = fields.ExternalSource;
        item.ExternalRef = fields.ExternalRef;
    }

    private void AddMediaRows(ContentItem item, PreparedFields fields)
    {
        _db.ContentItemMedia.AddRange(fields.Media.Select((media, order) => new ContentItemMedia
        {
            Id = Guid.NewGuid(),
            ExerciseId = item.ExerciseId,
            ContentItemId = item.Id,
            MediaAssetId = media.AssetId,
            Role = media.Role,
            SortOrder = order,
            Alt = media.Alt,
        }));
    }

    /// <summary>Soft-deletes the item's live media rows and writes the new set, unless the set is unchanged (XC-010).</summary>
    private async Task ReplaceMediaAsync(ContentItem item, PreparedFields fields, ContentEventTime time, CancellationToken cancellationToken)
    {
        var current = await _db.ContentItemMedia
            .Where(row => row.ContentItemId == item.Id)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var unchanged = current.Count == fields.Media.Count
            && current.Zip(fields.Media).All(pair =>
                pair.First.MediaAssetId == pair.Second.AssetId
                && pair.First.Role == pair.Second.Role
                && pair.First.Alt == pair.Second.Alt);
        if (unchanged)
        {
            return;
        }

        foreach (var row in current)
        {
            row.DeletedAt = time.WallClock;
        }

        AddMediaRows(item, fields);
    }

    /// <summary>
    /// Snapshots the item's CURRENT fields (before the change is applied) as revision <c>RevisionCount + 1</c>. The
    /// <c>(ContentItemId, Number)</c> unique index and the item's version token keep a racing revise from writing twice.
    /// </summary>
    private async Task AddRevisionAsync(
        ContentItem item,
        string kind,
        string? note,
        bool visible,
        ContentCaller caller,
        ContentEventTime time,
        CancellationToken cancellationToken)
    {
        var media = await _db.ContentItemMedia
            .AsNoTracking()
            .Where(row => row.ContentItemId == item.Id)
            .OrderBy(row => row.SortOrder)
            .Select(row => new { mediaId = row.MediaAssetId, role = row.Role, alt = row.Alt })
            .ToListAsync(cancellationToken);

        JsonNode? payload;
        try
        {
            payload = JsonNode.Parse(item.PayloadJson);
        }
        catch (JsonException)
        {
            payload = null;
        }

        var snapshot = JsonSerializer.Serialize(
            new
            {
                outletId = item.OutletId,
                slug = item.Slug,
                headline = item.Headline,
                dek = item.Dek,
                kicker = item.Kicker,
                category = item.Category,
                bylineName = item.BylineName,
                bylinePersonaId = item.BylinePersonaId,
                bodyHtml = item.BodyHtml,
                heroMediaId = item.HeroMediaId,
                media,
                payload,
                background = item.Background,
                featuredRank = item.FeaturedRank,
            },
            SnapshotOptions);

        item.RevisionCount++;
        _db.ContentItemRevisions.Add(new ContentItemRevision
        {
            Id = Guid.NewGuid(),
            ExerciseId = item.ExerciseId,
            ContentItemId = item.Id,
            Number = item.RevisionCount,
            Kind = kind,
            Note = note,
            SnapshotJson = snapshot,
            ScenarioTime = time.ScenarioTime,
            WallClock = time.WallClock,
            ActingHumanId = caller.ActingHumanId,
            Visible = visible,
        });
    }

    /// <summary>
    /// A slug unique within the outlet (FC-1): <c>[a-z0-9-]{1,80}</c> derived from the headline, <c>-2</c>, <c>-3</c> ...
    /// on collision. Soft-deleted items keep their slugs (the unique index covers them), so they count as taken.
    /// </summary>
    private async Task<string> UniqueSlugAsync(Guid outletId, string headline, Guid? excludeId, CancellationToken cancellationToken)
    {
        var slug = BaseSlug(headline);
        var prefix = slug.Length > ChannelVocabulary.SlugMaxLength - SlugSuffixRoom
            ? slug[..(ChannelVocabulary.SlugMaxLength - SlugSuffixRoom)]
            : slug;

        var taken = (await _db.IncludingSoftDeleted<ContentItem>()
                .AsNoTracking()
                .Where(item => item.OutletId == outletId && item.Id != (excludeId ?? Guid.Empty) && item.Slug.StartsWith(prefix))
                .Select(item => item.Slug)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        if (!taken.Contains(slug))
        {
            return slug;
        }

        for (var n = 2; ; n++)
        {
            var suffix = "-" + n.ToString(CultureInfo.InvariantCulture);
            var stem = slug.Length + suffix.Length > ChannelVocabulary.SlugMaxLength
                ? slug[..(ChannelVocabulary.SlugMaxLength - suffix.Length)].TrimEnd('-')
                : slug;
            var candidate = stem + suffix;
            if (!taken.Contains(candidate))
            {
                return candidate;
            }
        }
    }

    /// <summary>The headline as <c>[a-z0-9-]{1,80}</c>: diacritics folded, everything else a single hyphen; "item" when empty.</summary>
    /// <param name="headline">The sanitized headline.</param>
    /// <returns>The base slug.</returns>
    public static string BaseSlug(string headline)
    {
        ArgumentNullException.ThrowIfNull(headline);

        var builder = new StringBuilder(Math.Min(headline.Length, ChannelVocabulary.SlugMaxLength));
        foreach (var c in headline.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsAsciiLetterOrDigit(c))
            {
                builder.Append(char.ToLowerInvariant(c));
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }

            if (builder.Length >= ChannelVocabulary.SlugMaxLength)
            {
                break;
            }
        }

        var slug = builder.ToString().Trim('-');
        return slug.Length == 0 ? "item" : slug;
    }

    private static bool TryParseId(string? value, out Guid id) => Guid.TryParse(value, out id) && id != Guid.Empty;

    /// <summary>The validated, sanitized fields of a write, ready to apply.</summary>
    private sealed record PreparedFields(
        string Headline,
        string? Dek,
        string? Kicker,
        string? Category,
        string? BylineName,
        Guid? BylinePersonaId,
        string BodyHtml,
        Guid? HeroMediaId,
        string PayloadJson,
        IReadOnlyList<PreparedMedia> Media,
        bool Background,
        int? FeaturedRank,
        string? ExternalSource,
        string? ExternalRef);

    /// <summary>One validated media row.</summary>
    private sealed record PreparedMedia(Guid AssetId, string Role, string? Alt);

    /// <summary>The prepared fields, or the 400 reasons.</summary>
    private sealed record Preparation(PreparedFields? Fields, IReadOnlyList<string> Errors);
}
