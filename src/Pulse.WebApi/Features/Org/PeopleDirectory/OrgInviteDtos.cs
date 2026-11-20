namespace Pulse.WebApi.Features.Org.PeopleDirectory;

using System.Text.Json.Serialization;

/// <summary>
/// The body of <c>POST /api/org/people/invite</c> (#575b). Nullable members, so a missing field is a 400 with an error
/// code, never a deserialization failure. No organization id: the tenant is the caller's own.
/// </summary>
public sealed class InviteOrgPersonRequest
{
    /// <summary>The invitee's email (normalized server-side: trimmed, lower-case).</summary>
    [JsonPropertyName("email")]
    public string? Email { get; init; }

    /// <summary>The invitee's display name (used only when the person is created).</summary>
    [JsonPropertyName("displayName")]
    public string? DisplayName { get; init; }
}

/// <summary>The invite's one-time answer: the person and the link to hand them.</summary>
public sealed class OrgInviteDto
{
    /// <summary>The invited person's id (new or reused).</summary>
    [JsonPropertyName("personId")]
    public required string PersonId { get; init; }

    /// <summary>The single-use invite link (<c>{FrontendBaseUrl}/staff/invite#token=…</c>). Shown once; never log it.</summary>
    [JsonPropertyName("inviteUrl")]
    public required string InviteUrl { get; init; }

    /// <summary>Whether the provider accepted the invite email (always <c>false</c> on a host without email).</summary>
    [JsonPropertyName("emailed")]
    public required bool Emailed { get; init; }

    /// <summary><c>true</c> when this invite created the person; <c>false</c> when an existing one was re-invited.</summary>
    [JsonPropertyName("created")]
    public required bool Created { get; init; }

    /// <inheritdoc />
    public override string ToString() => $"OrgInviteDto {{ PersonId = {PersonId}, Created = {Created} }}";
}

/// <summary>The outcome kind of an <see cref="OrgInviteService"/> call.</summary>
public enum OrgInviteOutcome
{
    /// <summary>The invite was issued — 200 with the link, once.</summary>
    Ok,

    /// <summary>A malformed body — 400 with an error code.</summary>
    Invalid,

    /// <summary>No live staff session or no resolved tenant — 401.</summary>
    Unauthenticated,

    /// <summary>Not an org admin on an org-scope session — 403.</summary>
    Forbidden,

    /// <summary>The person cannot be (re-)invited — 409 with an error code.</summary>
    Conflict,

    /// <summary>No frontend base URL is configured, so no link can be built — 503.</summary>
    Unavailable,
}

/// <summary>The result of an <see cref="OrgInviteService"/> call.</summary>
public sealed class OrgInviteResult
{
    private OrgInviteResult(OrgInviteOutcome outcome, OrgInviteDto? invite, string? error)
    {
        Outcome = outcome;
        Invite = invite;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public OrgInviteOutcome Outcome { get; }

    /// <summary>The invite on <see cref="OrgInviteOutcome.Ok"/>.</summary>
    public OrgInviteDto? Invite { get; }

    /// <summary>The error code (400 / 409 / 503).</summary>
    public string? Error { get; }

    /// <summary>A success.</summary>
    /// <param name="invite">The invite.</param>
    /// <returns>The result.</returns>
    public static OrgInviteResult Ok(OrgInviteDto invite) => new(OrgInviteOutcome.Ok, invite, null);

    /// <summary>A 400.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static OrgInviteResult Invalid(string error) => new(OrgInviteOutcome.Invalid, null, error);

    /// <summary>A 401.</summary>
    /// <returns>The result.</returns>
    public static OrgInviteResult Unauthenticated() => new(OrgInviteOutcome.Unauthenticated, null, null);

    /// <summary>A 403.</summary>
    /// <returns>The result.</returns>
    public static OrgInviteResult Forbidden() => new(OrgInviteOutcome.Forbidden, null, null);

    /// <summary>A 409.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static OrgInviteResult Conflict(string error) => new(OrgInviteOutcome.Conflict, null, error);

    /// <summary>A 503.</summary>
    /// <returns>The result.</returns>
    public static OrgInviteResult Unavailable() => new(OrgInviteOutcome.Unavailable, null, OrgInviteService.LinkUnavailableError);

    /// <inheritdoc />
    public override string ToString() => $"OrgInviteResult {{ Outcome = {Outcome} }}";
}
