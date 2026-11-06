namespace Pulse.WebApi.Features.News;

using System.Text.Json;
using System.Text.Json.Nodes;

/// <summary>
/// The strict reader behind <see cref="ArticleKindDescriptor.ValidatePayloadAsync"/> (news story 01). It REFUSES, never
/// repairs: an unknown key, a wrong type, an out-of-range length, markup (<c>&lt;</c> / <c>&gt;</c>) or an invisible control
/// character in any string is a field-level error, never a silent strip (NFR-004). The only change it makes to an
/// accepted value is trimming surrounding whitespace.
/// </summary>
internal static class ArticlePayloadReader
{
    private static readonly HashSet<string> TopLevelKeys = new(StringComparer.Ordinal)
    {
        ArticlePayload.BreakingKey, ArticlePayload.DatelineKey, ArticlePayload.SlugCodeKey, ArticlePayload.StoryTypeKey,
    };

    private static readonly HashSet<string> BreakingKeys = new(StringComparer.Ordinal) { "text" };

    private static readonly HashSet<string> DatelineKeys = new(StringComparer.Ordinal) { "place", "agency" };

    /// <summary>Reads and validates a whole payload from a write request.</summary>
    /// <param name="payload">The untrusted payload.</param>
    /// <param name="errors">Receives one message per problem, prefixed with its payload path.</param>
    /// <returns>The payload, or null when <paramref name="errors"/> gained an entry.</returns>
    public static ArticlePayload? Read(JsonObject payload, List<string> errors)
    {
        var before = errors.Count;
        foreach (var (key, _) in payload)
        {
            if (!TopLevelKeys.Contains(key))
            {
                errors.Add($"payload.{key} is not an article payload field (allowed: breaking, dateline, slugCode, storyType).");
            }
        }

        var result = new ArticlePayload(
            ReadBreaking(payload[ArticlePayload.BreakingKey], errors),
            ReadDateline(payload[ArticlePayload.DatelineKey], errors),
            ReadSlugCode(payload[ArticlePayload.SlugCodeKey], errors),
            ReadStoryType(payload[ArticlePayload.StoryTypeKey], errors));
        return errors.Count == before ? result : null;
    }

    /// <summary>Reads <c>breaking</c>: absent or null = none; else exactly <c>{ text }</c>.</summary>
    internal static ArticleBreaking? ReadBreaking(JsonNode? node, List<string> errors)
    {
        const string path = "payload.breaking";
        if (node is null)
        {
            return null;
        }

        if (node is not JsonObject breaking)
        {
            errors.Add($"{path} must be an object {{ text }} or null.");
            return null;
        }

        var before = errors.Count;
        UnknownKeys(breaking, BreakingKeys, path, errors);
        var text = RequiredText(breaking["text"], $"{path}.text", ArticlePayload.MaxBreakingTextLength, errors);
        return errors.Count == before && text is not null ? new ArticleBreaking(text) : null;
    }

    /// <summary>Reads <c>dateline</c>: absent or null = none; else <c>{ place, agency? }</c>.</summary>
    internal static ArticleDateline? ReadDateline(JsonNode? node, List<string> errors)
    {
        const string path = "payload.dateline";
        if (node is null)
        {
            return null;
        }

        if (node is not JsonObject dateline)
        {
            errors.Add($"{path} must be an object {{ place, agency? }} or null.");
            return null;
        }

        var before = errors.Count;
        UnknownKeys(dateline, DatelineKeys, path, errors);
        var place = RequiredText(dateline["place"], $"{path}.place", ArticlePayload.MaxDatelinePlaceLength, errors);
        // agency is optional: absent or null = none.
        var agency = dateline["agency"] is { } agencyNode
            ? RequiredText(agencyNode, $"{path}.agency", ArticlePayload.MaxDatelineAgencyLength, errors)
            : null;
        return errors.Count == before && place is not null ? new ArticleDateline(place, agency) : null;
    }

    /// <summary>Reads <c>slugCode</c>: absent = none; else a 1..48 code-point plain string.</summary>
    internal static string? ReadSlugCode(JsonNode? node, List<string> errors) =>
        node is null ? null : RequiredText(node, "payload.slugCode", ArticlePayload.MaxSlugCodeLength, errors);

    /// <summary>Reads <c>storyType</c>: absent = none; else one of <see cref="ArticlePayload.StoryTypes"/>.</summary>
    internal static string? ReadStoryType(JsonNode? node, List<string> errors)
    {
        if (node is null)
        {
            return null;
        }

        if (node is JsonValue value
            && value.GetValueKind() == JsonValueKind.String
            && ArticlePayload.StoryTypes.Contains(value.GetValue<string>(), StringComparer.Ordinal))
        {
            return value.GetValue<string>();
        }

        errors.Add($"payload.storyType must be one of {string.Join(", ", ArticlePayload.StoryTypes)}.");
        return null;
    }

    private static void UnknownKeys(JsonObject json, HashSet<string> allowed, string path, List<string> errors)
    {
        foreach (var (key, _) in json)
        {
            if (!allowed.Contains(key))
            {
                errors.Add($"{path}.{key} is not allowed (allowed: {string.Join(", ", allowed)}).");
            }
        }
    }

    /// <summary>A required plain-text string: trimmed, 1..<paramref name="max"/> code points, no markup, no controls.</summary>
    private static string? RequiredText(JsonNode? node, string path, int max, List<string> errors)
    {
        if (node is not JsonValue value || value.GetValueKind() != JsonValueKind.String)
        {
            errors.Add($"{path} must be a string of 1 to {max} characters.");
            return null;
        }

        var text = value.GetValue<string>().Trim();
        var length = text.EnumerateRunes().Count();
        if (length is 0 || length > max)
        {
            errors.Add($"{path} must be 1 to {max} characters (was {length}).");
            return null;
        }

        if (text.AsSpan().IndexOfAny('<', '>') >= 0)
        {
            errors.Add($"{path} must be plain text: markup (< or >) is not allowed.");
            return null;
        }

        if (text.Any(IsInvisibleOrControl))
        {
            errors.Add($"{path} must be plain text on one line: control, invisible and direction characters are not allowed.");
            return null;
        }

        return text;
    }

    // Controls; line/paragraph separators (U+2028/2029, "one line"); zero-width characters (U+200B-200D, U+2060, U+FEFF);
    // and the bidi marks, embeddings, overrides and isolates (U+061C, U+200E/F, U+202A-202E, U+2066-2069), which are
    // invisible and can reorder displayed text (spoofing).
    private static bool IsInvisibleOrControl(char c) =>
        char.IsControl(c)
        || c is (char)0x061C or (char)0x2028 or (char)0x2029 or (char)0x2060 or (char)0xFEFF
        || c is >= (char)0x200B and <= (char)0x200F
        || c is >= (char)0x202A and <= (char)0x202E
        || c is >= (char)0x2066 and <= (char)0x2069;
}
