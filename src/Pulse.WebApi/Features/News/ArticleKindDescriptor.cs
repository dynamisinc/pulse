namespace Pulse.WebApi.Features.News;

using System.Collections.Frozen;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The <c>article</c> kind on channel <c>news</c> (news-network story 01, #718; NWS-010/012/013/022/032, NFR-004): the
/// article's data contract. The D3-P1 slot anatomy is the rendering contract; this is what the slots may rely on.
/// </summary>
/// <remarks>
/// <para>
/// <b>Payload (E4-C1)</b>, validated by <see cref="ArticlePayloadReader"/>: <c>{ breaking?: { text } | null, dateline?:
/// { place, agency? } | null, slugCode?, storyType? }</c>. Refused, never repaired: unknown keys, wrong types, lengths out
/// of range, markup or control characters. A valid payload is stored normalized (<see cref="ArticlePayload.ToStoredJson"/>).
/// The kicker, dek, byline, category, hero and media are <c>ContentItem</c> columns, never payload.
/// </para>
/// <para>
/// <b>Body:</b> the <see cref="ArticleBodyProfile"/> (<c>article-rich</c>) profile. <b>Media:</b> images and videos (the
/// funnel refuses a <c>document</c>); at most one hero; a video hero needs a poster frame.
/// </para>
/// <para>
/// <b>Projection (XC-002):</b> exactly <c>{ breaking, dateline, slugCode }</c>; <c>storyType</c> and anything unknown in the
/// stored payload are never projected. <b>Alert:</b> a breaking article SUGGESTS an <c>advisory</c> (<see cref="SuggestAlert"/>);
/// nothing here raises one (NWS-012, FC-7a). Validation is origin-blind, so an engine draft (NWS-022) or a Cadence-pushed
/// article is held to exactly the same rules; the funnel keeps an engine write a draft.
/// </para>
/// </remarks>
public sealed class ArticleKindDescriptor : IContentKindDescriptor
{
    /// <summary>The message when a write names more than one hero.</summary>
    public const string OneHeroMessage =
        "An article has at most one hero: heroMediaId and every media entry with role \"hero\" must name the same item.";

    /// <summary>The message when the hero is a video without a poster frame.</summary>
    public const string VideoHeroPosterMessage =
        "A video hero needs a poster frame. Wait for the upload's poster to finish processing, or choose an image hero.";

    private static readonly FrozenSet<string> MediaKindsAllowed =
        new[] { MediaKinds.Image, MediaKinds.Video }.ToFrozenSet(StringComparer.Ordinal);

    /// <summary>The kind-level suggestion shape: an advisory whose headline is the item's own (headline null).</summary>
    private static readonly PublishAlertOptions AdvisorySuggestion = new() { Severity = ChannelVocabulary.SeverityAdvisory };

    /// <inheritdoc />
    public string Kind => ChannelVocabulary.KindArticle;

    /// <inheritdoc />
    public string ChannelId => ChannelVocabulary.News;

    /// <inheritdoc />
    public string BodyPolicy => ArticleBodyProfile.Name;

    /// <inheritdoc />
    public IReadOnlySet<string> AllowedMediaKinds => MediaKindsAllowed;

    /// <inheritdoc />
    /// <remarks>
    /// The KIND-level shape of the suggestion: an <c>advisory</c> with the item's headline. Whether an item gets it at all
    /// depends on its payload, so the publish dialog must ask <see cref="SuggestAlert"/> (only a breaking article suggests).
    /// </remarks>
    public PublishAlertOptions? DefaultAlertMapping => AdvisorySuggestion;

    /// <summary>
    /// The alert the publish dialog pre-fills for <paramref name="item"/>: an <c>advisory</c> whose headline is the article's
    /// headline verbatim, ONLY when its stored payload carries a breaking banner; otherwise null. The <c>href</c> is the
    /// item's permalink, filled by the funnel when the controller chooses to raise it (FC-7). A suggestion only: a breaking
    /// banner never implies an alert-bar entry (NWS-012).
    /// </summary>
    /// <param name="item">The article being published.</param>
    /// <returns>The suggestion, or null.</returns>
    public PublishAlertOptions? SuggestAlert(ContentItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        return ArticlePayload.ReadStored(item.PayloadJson).IsBreaking
            ? AdvisorySuggestion with { Headline = item.Headline }
            : null;
    }

    /// <inheritdoc />
    public async Task<PayloadValidationResult> ValidatePayloadAsync(
        JsonObject payload, PayloadValidationContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(context);

        var errors = new List<string>();
        var article = ArticlePayloadReader.Read(payload, errors);
        await CheckHeroAsync(context, errors, cancellationToken);

        if (errors.Count > 0)
        {
            return PayloadValidationResult.Invalid(errors[0], [.. errors.Skip(1)]);
        }

        // The funnel stores the object it passed in: replace its content with the normalized form.
        payload.Clear();
        foreach (var (key, value) in article!.ToStoredJson())
        {
            payload[key] = value?.DeepClone();
        }

        return PayloadValidationResult.Valid;
    }

    /// <inheritdoc />
    public JsonObject ProjectPayload(JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        return ArticlePayload.ReadStored(payload).ToParticipantJson();
    }

    /// <summary>The media rules the funnel cannot know: one hero, and a video hero has a poster.</summary>
    private static async Task CheckHeroAsync(PayloadValidationContext context, List<string> errors, CancellationToken cancellationToken)
    {
        var heroes = context.Media
            .Where(media => string.Equals(media.Role, ChannelVocabulary.MediaRoleHero, StringComparison.Ordinal))
            .Select(media => media.MediaId)
            .ToList();
        if (heroes.Count > 1 || (context.HeroMediaId is { } named && heroes.Any(id => id != named)))
        {
            errors.Add(OneHeroMessage);
            return;
        }

        var hero = context.HeroMediaId ?? (heroes.Count == 1 ? heroes[0] : null);
        if (hero is null)
        {
            return;
        }

        // Exercise-scoped by the central query filter; the funnel already proved the asset is in scope.
        var asset = await context.Db.MediaAssets
            .AsNoTracking()
            .Where(candidate => candidate.Id == hero)
            .Select(candidate => new { candidate.Kind, candidate.PosterMediaAssetId })
            .FirstOrDefaultAsync(cancellationToken);
        if (asset is { Kind: MediaKinds.Video, PosterMediaAssetId: null })
        {
            errors.Add(VideoHeroPosterMessage);
        }
    }
}
