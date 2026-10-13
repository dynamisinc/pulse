namespace Pulse.WebApi.Features.Identity.LinkCards;

using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>What <see cref="LinkCardService.GenerateAsync"/> decided. The endpoint maps each value to exactly one status.</summary>
public enum LinkCardOutcome
{
    /// <summary>The card sheet was built (<c>200</c>), possibly with no cards and some skips.</summary>
    Ok,

    /// <summary>No staff session, or no resolved exercise (<c>401</c>, fail closed).</summary>
    Unauthenticated,

    /// <summary>A staff caller who is not a controller or planner on the resolved exercise (<c>403</c>).</summary>
    Forbidden,

    /// <summary>More ids than <see cref="EasyLoginOptions.MaxCardsPerRequest"/> (<c>400</c>).</summary>
    TooManyIds,

    /// <summary><c>Authentication:FrontendBaseUrl</c> is not usable, so no join URL can be built (<c>409</c>).</summary>
    JoinLinksUnavailable,
}

/// <summary>The result of one card-sheet request: an outcome and, only for <see cref="LinkCardOutcome.Ok"/>, the body.</summary>
public sealed class LinkCardResult
{
    private LinkCardResult(LinkCardOutcome outcome, RosterCardsDto? sheet, string? message)
    {
        Outcome = outcome;
        Sheet = sheet;
        Message = message;
    }

    /// <summary>The outcome.</summary>
    public LinkCardOutcome Outcome { get; }

    /// <summary>The <c>RosterCardsDto</c> body, set only when <see cref="Outcome"/> is <see cref="LinkCardOutcome.Ok"/>.</summary>
    public RosterCardsDto? Sheet { get; }

    /// <summary>A readable, secret-free reason for a <c>400</c> or <c>409</c> (the ProblemDetails <c>detail</c>).</summary>
    public string? Message { get; }

    /// <summary>The sheet was built.</summary>
    /// <param name="sheet">The response body.</param>
    /// <returns>An <see cref="LinkCardOutcome.Ok"/> result.</returns>
    public static LinkCardResult Ok(RosterCardsDto sheet)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        return new LinkCardResult(LinkCardOutcome.Ok, sheet, message: null);
    }

    /// <summary>No staff session or no resolved exercise.</summary>
    /// <returns>An <see cref="LinkCardOutcome.Unauthenticated"/> result.</returns>
    public static LinkCardResult Unauthenticated() => new(LinkCardOutcome.Unauthenticated, sheet: null, message: null);

    /// <summary>The caller may not print cards on this exercise.</summary>
    /// <returns>A <see cref="LinkCardOutcome.Forbidden"/> result.</returns>
    public static LinkCardResult Forbidden() => new(LinkCardOutcome.Forbidden, sheet: null, message: null);

    /// <summary>Too many ids in one request.</summary>
    /// <param name="max">The configured cap.</param>
    /// <returns>A <see cref="LinkCardOutcome.TooManyIds"/> result.</returns>
    public static LinkCardResult TooManyIds(int max) => new(
        LinkCardOutcome.TooManyIds,
        sheet: null,
        $"At most {max} participant ids may be requested at once.");

    /// <summary>No join base is configured.</summary>
    /// <returns>A <see cref="LinkCardOutcome.JoinLinksUnavailable"/> result.</returns>
    public static LinkCardResult JoinLinksUnavailable() => new(
        LinkCardOutcome.JoinLinksUnavailable,
        sheet: null,
        "Join links are not configured on this server (Authentication:FrontendBaseUrl is not set), so no card can be printed.");
}
