namespace Pulse.WebApi.Features.Channels.Alerts;

using System.Globalization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The pure validation core for a raise (channels-foundation story 10). Every raiser goes through it, the staff route
/// and the in-process <see cref="IAlertRaiser"/> callers alike, so an alert that reaches the bar is always well formed:
/// a frozen severity, a plain-text headline of 1..<see cref="MaxHeadlineLength"/> characters, a host-relative
/// <c>href</c> (FC-9.3) and a scenario-time expiry still in the future.
/// </summary>
/// <remarks>
/// <b>The headline is sanitized, then kept verbatim (D4-010).</b> Markup is stripped with the post funnel's own
/// <see cref="PostSanitizer"/> (NFR-004: strip, never encode) and the ends trimmed; nothing else is rewritten, so the
/// bar, the post, the widget and the product page carry the same string. Lengths are code points, so an emoji counts
/// once.
/// </remarks>
public static class AlertRaiseValidator
{
    /// <summary>The longest headline, in code points.</summary>
    public const int MaxHeadlineLength = 200;

    /// <summary>Validates a raise against the exercise's current scenario instant.</summary>
    /// <param name="raise">The raise as requested.</param>
    /// <param name="scenarioNow">The exercise's scenario instant (an expiry must be after it).</param>
    /// <returns>The normalized raise, or the first readable error.</returns>
    public static AlertRaiseValidation Validate(AlertRaise? raise, DateTimeOffset scenarioNow)
    {
        if (raise is null)
        {
            return AlertRaiseValidation.Fail("A request body is required.");
        }

        if (raise.Severity is null || !ChannelVocabulary.AlertSeverities.Contains(raise.Severity, StringComparer.Ordinal))
        {
            return AlertRaiseValidation.Fail("severity must be one of info, advisory or emergency.");
        }

        var headline = raise.Headline is null ? string.Empty : PostSanitizer.Sanitize(raise.Headline).Trim();
        var headlineLength = CodePoints(headline);
        // Code points are what a controller sees; the column (nvarchar) counts UTF-16 units, so a headline heavy in
        // astral characters (emoji) is also held to the stored bound rather than failing the save.
        if (headlineLength is < 1 or > MaxHeadlineLength)
        {
            return AlertRaiseValidation.Fail($"headline must be between 1 and {MaxHeadlineLength} characters of plain text.");
        }

        if (headline.Length > ChannelAlert.MaxHeadlineLength)
        {
            return AlertRaiseValidation.Fail(
                "headline is too long to store: emoji and other symbols count double. Shorten it or use fewer symbols.");
        }

        if (raise.Href is not null
            && (raise.Href.Length > ChannelAlert.MaxHrefLength || !ChannelVocabulary.IsHostRelativePath(raise.Href)))
        {
            return AlertRaiseValidation.Fail(
                $"href must be a host-relative path starting with a single '/' (at most {ChannelAlert.MaxHrefLength} characters), or null.");
        }

        if (!string.Equals(raise.SourceChannel, ChannelVocabulary.AlertSourceSystem, StringComparison.Ordinal)
            && !ChannelVocabulary.IsChannelId(raise.SourceChannel))
        {
            return AlertRaiseValidation.Fail("sourceChannel must be a channel id or 'system'.");
        }

        if (raise.SourceContentId == Guid.Empty)
        {
            return AlertRaiseValidation.Fail("sourceContentId must be a content item id, or null.");
        }

        DateTimeOffset? expires = null;
        if (raise.ExpiresScenarioTime is not null)
        {
            if (!TryParseInstant(raise.ExpiresScenarioTime, out var parsed))
            {
                return AlertRaiseValidation.Fail("expiresScenarioTime must be an ISO 8601 instant with an offset, or null.");
            }

            if (parsed <= scenarioNow)
            {
                return AlertRaiseValidation.Fail("expiresScenarioTime must be later than the current scenario time.");
            }

            expires = parsed;
        }

        return AlertRaiseValidation.Ok(new ValidatedAlertRaise(
            raise.Severity,
            headline,
            raise.Href,
            raise.SourceChannel,
            raise.SourceContentId,
            expires));
    }

    /// <summary>Whether <paramref name="caller"/> is a usable provenance (a known origin and an acting human).</summary>
    /// <param name="caller">The caller.</param>
    /// <returns>The error, or null when valid.</returns>
    public static string? ValidateCaller(ContentCaller? caller)
    {
        if (caller is null)
        {
            return "A caller is required.";
        }

        if (!ChannelVocabulary.ContentOrigins.Contains(caller.Origin, StringComparer.Ordinal))
        {
            return "caller.Origin must be one of controller, participant, engine or inject.";
        }

        if (string.IsNullOrWhiteSpace(caller.ActingHumanId))
        {
            return "caller.ActingHumanId is required.";
        }

        if (caller.Origin == ChannelVocabulary.OriginInject && caller.InjectId is null)
        {
            return "caller.InjectId is required when caller.Origin is inject.";
        }

        return caller.ActingHumanId.Length > ContentItem.MaxActingHumanIdLength
            ? $"caller.ActingHumanId must be at most {ContentItem.MaxActingHumanIdLength} characters."
            : null;
    }

    /// <summary>
    /// Parses an ISO 8601 instant that names its offset (<c>Z</c> or <c>±hh:mm</c>); a bare local time is refused
    /// rather than guessed at.
    /// </summary>
    private static bool TryParseInstant(string value, out DateTimeOffset instant)
    {
        instant = default;
        if (!DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var probe)
            || probe.Kind == DateTimeKind.Unspecified)
        {
            return false;
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out instant);
    }

    private static int CodePoints(string value)
    {
        var count = 0;
        foreach (var _ in value.EnumerateRunes())
        {
            count++;
        }

        return count;
    }
}

/// <summary>A raise that passed <see cref="AlertRaiseValidator.Validate"/>.</summary>
/// <param name="Severity">The severity literal.</param>
/// <param name="Headline">The sanitized, trimmed headline, kept verbatim from here on.</param>
/// <param name="Href">The host-relative target, or null.</param>
/// <param name="SourceChannel">A channel id or <c>system</c>.</param>
/// <param name="SourceContentId">The raising content item, or null.</param>
/// <param name="ExpiresScenarioTime">The parsed scenario-time expiry, or null.</param>
public sealed record ValidatedAlertRaise(
    string Severity,
    string Headline,
    string? Href,
    string SourceChannel,
    Guid? SourceContentId,
    DateTimeOffset? ExpiresScenarioTime);

/// <summary>The outcome of <see cref="AlertRaiseValidator.Validate"/>: a normalized raise, or a readable error.</summary>
/// <param name="Raise">The normalized raise when valid.</param>
/// <param name="Error">The first error when invalid.</param>
public sealed record AlertRaiseValidation(ValidatedAlertRaise? Raise, string? Error)
{
    /// <summary>A valid raise.</summary>
    /// <param name="raise">The normalized raise.</param>
    /// <returns>The outcome.</returns>
    public static AlertRaiseValidation Ok(ValidatedAlertRaise raise) => new(raise, null);

    /// <summary>An invalid raise.</summary>
    /// <param name="error">The readable error.</param>
    /// <returns>The outcome.</returns>
    public static AlertRaiseValidation Fail(string error) => new(null, error);
}
