namespace Pulse.WebApi.Features.Identity.LinkEmail;

using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>What <see cref="LinkEmailService.SendAsync"/> decided. The endpoint maps each value to exactly one status.</summary>
public enum LinkEmailOutcome
{
    /// <summary>The batch ran (<c>200</c>): every participant considered has a result, whatever happened to the sends.</summary>
    Ok,

    /// <summary>No staff session, or no resolved exercise (<c>401</c>, fail closed).</summary>
    Unauthenticated,

    /// <summary>A staff caller who is not a controller or planner on the resolved exercise (<c>403</c>).</summary>
    Forbidden,

    /// <summary>The body is not the strict <c>{ participantIds? }</c> shape (<c>400</c>).</summary>
    Invalid,

    /// <summary>More than <see cref="LinkEmailService.MaxParticipantsPerRequest"/> ids, or eligible people when ids are omitted (<c>400</c>).</summary>
    TooMany,

    /// <summary>Email delivery is not configured on this host (<c>503</c>). Nothing was sent.</summary>
    NotConfigured,

    /// <summary><c>Authentication:FrontendBaseUrl</c> is not usable, so no join link can be built (<c>503</c>). Nothing was sent.</summary>
    JoinLinksUnavailable,
}

/// <summary>The fixed, generic <c>reason</c> values of a <c>failed</c> result (never a provider message).</summary>
public static class RosterEmailFailureReasons
{
    /// <summary>The provider refused the send, could not be reached, timed out, or the credential failed.</summary>
    public const string SendFailed = "sendFailed";

    /// <summary>The provider throttled the send (<c>429</c>). Try again later.</summary>
    public const string RateLimited = "rateLimited";

    /// <summary>The batch reached its time limit before this participant; nothing was attempted. Send again.</summary>
    public const string NotAttempted = "notAttempted";
}

/// <summary>
/// The <c>skipped</c> reasons of an email result (story 13 AC): the card sheet's four (<see cref="RosterCardSkipReasons"/>)
/// plus <see cref="NoEmail"/>. A participant from another exercise is <see cref="NotFound"/>, exactly like an unknown id.
/// </summary>
public static class RosterEmailSkipReasons
{
    /// <summary>The participant has no usable email address.</summary>
    public const string NoEmail = "noEmail";

    /// <summary>The participant has no active link.</summary>
    public const string NoActiveLink = RosterCardSkipReasons.NoActiveLink;

    /// <summary>The participant is disabled.</summary>
    public const string Disabled = RosterCardSkipReasons.Disabled;

    /// <summary>The link's protected copy no longer decrypts (reissue it).</summary>
    public const string TokenUnrecoverable = RosterCardSkipReasons.TokenUnrecoverable;

    /// <summary>Unknown id, malformed id, or an id from another exercise (indistinguishable by design).</summary>
    public const string NotFound = RosterCardSkipReasons.NotFound;
}

/// <summary>The result of one email request: an outcome and, only for <see cref="LinkEmailOutcome.Ok"/>, the body.</summary>
public sealed class LinkEmailResult
{
    /// <summary>The <c>503</c> detail when email delivery is not configured (story 13 AC, verbatim).</summary>
    public const string NotConfiguredMessage = "Email delivery is not configured";

    /// <summary>The <c>503</c> detail when no join link can be built.</summary>
    public const string JoinLinksUnavailableMessage =
        "Join links are not configured on this server (Authentication:FrontendBaseUrl is not set), so no link can be emailed.";

    private LinkEmailResult(LinkEmailOutcome outcome, RosterEmailResultDto? body, string? message)
    {
        Outcome = outcome;
        Body = body;
        Message = message;
    }

    /// <summary>The outcome.</summary>
    public LinkEmailOutcome Outcome { get; }

    /// <summary>The <c>RosterEmailResultDto</c>, set only when <see cref="Outcome"/> is <see cref="LinkEmailOutcome.Ok"/>.</summary>
    public RosterEmailResultDto? Body { get; }

    /// <summary>A readable, secret-free reason for a <c>400</c> or <c>503</c> (the ProblemDetails <c>detail</c>).</summary>
    public string? Message { get; }

    /// <summary>The batch ran.</summary>
    /// <param name="body">The response body.</param>
    /// <returns>An <see cref="LinkEmailOutcome.Ok"/> result.</returns>
    public static LinkEmailResult Ok(RosterEmailResultDto body)
    {
        ArgumentNullException.ThrowIfNull(body);
        return new LinkEmailResult(LinkEmailOutcome.Ok, body, message: null);
    }

    /// <summary>No staff session or no resolved exercise.</summary>
    /// <returns>An <see cref="LinkEmailOutcome.Unauthenticated"/> result.</returns>
    public static LinkEmailResult Unauthenticated() => new(LinkEmailOutcome.Unauthenticated, body: null, message: null);

    /// <summary>The caller may not email links on this exercise.</summary>
    /// <returns>A <see cref="LinkEmailOutcome.Forbidden"/> result.</returns>
    public static LinkEmailResult Forbidden() => new(LinkEmailOutcome.Forbidden, body: null, message: null);

    /// <summary>The body has the wrong shape.</summary>
    /// <param name="message">A readable, secret-free reason.</param>
    /// <returns>An <see cref="LinkEmailOutcome.Invalid"/> result.</returns>
    public static LinkEmailResult Invalid(string message)
    {
        ArgumentException.ThrowIfNullOrEmpty(message);
        return new LinkEmailResult(LinkEmailOutcome.Invalid, body: null, message);
    }

    /// <summary>Too many people for one request.</summary>
    /// <param name="message">A readable, secret-free reason.</param>
    /// <returns>A <see cref="LinkEmailOutcome.TooMany"/> result.</returns>
    public static LinkEmailResult TooMany(string message)
    {
        ArgumentException.ThrowIfNullOrEmpty(message);
        return new LinkEmailResult(LinkEmailOutcome.TooMany, body: null, message);
    }

    /// <summary>Email delivery is not configured.</summary>
    /// <returns>A <see cref="LinkEmailOutcome.NotConfigured"/> result.</returns>
    public static LinkEmailResult NotConfigured() =>
        new(LinkEmailOutcome.NotConfigured, body: null, NotConfiguredMessage);

    /// <summary>No join base is configured.</summary>
    /// <returns>A <see cref="LinkEmailOutcome.JoinLinksUnavailable"/> result.</returns>
    public static LinkEmailResult JoinLinksUnavailable() =>
        new(LinkEmailOutcome.JoinLinksUnavailable, body: null, JoinLinksUnavailableMessage);
}
