namespace Pulse.WebApi.Features.News;

using System.Text.Json;
using System.Text.Json.Nodes;

/// <summary>
/// E4-C1, the article payload (<c>ContentItem.PayloadJson</c> for <c>kind: article</c>; news story 01, #718). Kicker, dek,
/// byline, category, hero and media are <c>ContentItem</c> columns, never payload keys.
/// </summary>
/// <param name="Breaking">The breaking banner (NWS-012), or null for none.</param>
/// <param name="Dateline">The dateline, or null for none.</param>
/// <param name="SlugCode">The desk slug code, or null.</param>
/// <param name="StoryType">The staff-only story type (<see cref="ArticlePayload.StoryTypes"/>), or null. Never projected.</param>
public sealed record ArticlePayload(ArticleBreaking? Breaking, ArticleDateline? Dateline, string? SlugCode, string? StoryType)
{
    /// <summary>The <c>breaking</c> key.</summary>
    public const string BreakingKey = "breaking";

    /// <summary>The <c>dateline</c> key.</summary>
    public const string DatelineKey = "dateline";

    /// <summary>The <c>slugCode</c> key.</summary>
    public const string SlugCodeKey = "slugCode";

    /// <summary>The <c>storyType</c> key (staff-only).</summary>
    public const string StoryTypeKey = "storyType";

    /// <summary>The longest breaking banner text, in code points.</summary>
    public const int MaxBreakingTextLength = 120;

    /// <summary>The longest dateline place, in code points.</summary>
    public const int MaxDatelinePlaceLength = 80;

    /// <summary>The longest dateline agency, in code points.</summary>
    public const int MaxDatelineAgencyLength = 40;

    /// <summary>The longest slug code, in code points.</summary>
    public const int MaxSlugCodeLength = 48;

    /// <summary>The closed <c>storyType</c> vocabulary (the four D3 article templates, story 18).</summary>
    public static IReadOnlyList<string> StoryTypes { get; } =
        ["breaking_hard_news", "follow_up", "human_interest", "press_conference_recap"];

    /// <summary>The empty payload (no banner, no dateline, no slug, no story type).</summary>
    public static ArticlePayload Empty { get; } = new(null, null, null, null);

    /// <summary>Whether the article carries a breaking banner (the only case that suggests an alert, NWS-012).</summary>
    public bool IsBreaking => Breaking is not null;

    /// <summary>
    /// The normalized stored form: <c>breaking</c> and <c>dateline</c> always present (null when unset), <c>slugCode</c> and
    /// <c>storyType</c> only when set. Unknown keys never appear (they are refused on write).
    /// </summary>
    /// <returns>A new JSON object.</returns>
    public JsonObject ToStoredJson()
    {
        var json = ToParticipantJson();
        json.Remove(SlugCodeKey);
        if (SlugCode is not null)
        {
            json[SlugCodeKey] = SlugCode;
        }

        if (StoryType is not null)
        {
            json[StoryTypeKey] = StoryType;
        }

        return json;
    }

    /// <summary>
    /// The participant projection (XC-002): exactly <c>{ breaking: { text } | null, dateline: { place, agency? } | null,
    /// slugCode: string | null }</c>. <c>storyType</c> is never included.
    /// </summary>
    /// <returns>A new JSON object.</returns>
    public JsonObject ToParticipantJson()
    {
        JsonObject? dateline = null;
        if (Dateline is not null)
        {
            dateline = new JsonObject { ["place"] = Dateline.Place };
            if (Dateline.Agency is not null)
            {
                dateline["agency"] = Dateline.Agency;
            }
        }

        return new JsonObject
        {
            [BreakingKey] = Breaking is null ? null : new JsonObject { ["text"] = Breaking.Text },
            [DatelineKey] = dateline,
            [SlugCodeKey] = SlugCode,
        };
    }

    /// <summary>
    /// Reads a STORED payload leniently, for projection and alert suggestion: each part that does not read cleanly is
    /// treated as absent (never echoed raw). Never throws on malformed JSON.
    /// </summary>
    /// <param name="payloadJson">The stored <c>PayloadJson</c>.</param>
    /// <returns>The readable parts.</returns>
    public static ArticlePayload ReadStored(string? payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return Empty;
        }

        try
        {
            return JsonNode.Parse(payloadJson) is JsonObject json ? ReadStored(json) : Empty;
        }
        catch (JsonException)
        {
            return Empty;
        }
    }

    /// <summary>Reads a stored payload leniently (see <see cref="ReadStored(string?)"/>).</summary>
    /// <param name="payload">The stored payload.</param>
    /// <returns>The readable parts.</returns>
    public static ArticlePayload ReadStored(JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        return new ArticlePayload(
            ArticlePayloadReader.ReadBreaking(payload[BreakingKey], []),
            ArticlePayloadReader.ReadDateline(payload[DatelineKey], []),
            ArticlePayloadReader.ReadSlugCode(payload[SlugCodeKey], []),
            ArticlePayloadReader.ReadStoryType(payload[StoryTypeKey], []));
    }
}

/// <summary>The breaking banner (NWS-012): one line of text above the headline.</summary>
/// <param name="Text">1..120 code points of plain text.</param>
public sealed record ArticleBreaking(string Text);

/// <summary>The dateline: where the story was filed, and optionally the agency (wire skins).</summary>
/// <param name="Place">1..80 code points of plain text.</param>
/// <param name="Agency">1..40 code points of plain text, or null.</param>
public sealed record ArticleDateline(string Place, string? Agency);
