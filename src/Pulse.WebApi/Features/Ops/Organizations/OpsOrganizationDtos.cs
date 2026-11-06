namespace Pulse.WebApi.Features.Ops.Organizations;

using System.Text.Json.Serialization;

/// <summary>The body of <c>POST /api/ops/organizations</c> (#575b). Nullable members: a missing field is a 400.</summary>
public sealed class CreateOrganizationRequest
{
    /// <summary>The organization's display name (unique across Pulse).</summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    /// <summary>The first org admin's email; the invite is delivered to it.</summary>
    [JsonPropertyName("adminEmail")]
    public string? AdminEmail { get; init; }

    /// <summary>The first org admin's display name (optional; defaults to the email's local part).</summary>
    [JsonPropertyName("adminDisplayName")]
    public string? AdminDisplayName { get; init; }
}

/// <summary>The provisioning's one-time answer.</summary>
public sealed class CreatedOrganizationDto
{
    /// <summary>The new organization's id.</summary>
    [JsonPropertyName("organizationId")]
    public required string OrganizationId { get; init; }

    /// <summary>The organization's name, as stored (trimmed).</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The organization's slug (the org sign-in's <c>orgSlug</c>).</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The first org admin's person id.</summary>
    [JsonPropertyName("adminPersonId")]
    public required string AdminPersonId { get; init; }

    /// <summary>The single-use invite link for the first admin. Shown once; never log it.</summary>
    [JsonPropertyName("inviteUrl")]
    public required string InviteUrl { get; init; }

    /// <summary>Whether the provider accepted the invite email (always <c>false</c> on a host without email).</summary>
    [JsonPropertyName("emailed")]
    public required bool Emailed { get; init; }

    /// <inheritdoc />
    public override string ToString() => $"CreatedOrganizationDto {{ OrganizationId = {OrganizationId}, Slug = {Slug} }}";
}

/// <summary>The error body of the ops organization route.</summary>
public sealed class OpsOrganizationErrorDto
{
    /// <summary>The error code.</summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }
}

/// <summary>The outcome kind of an <see cref="OpsOrganizationService"/> call.</summary>
public enum OpsOrganizationOutcome
{
    /// <summary>Provisioned — 201 with the invite link, once.</summary>
    Created,

    /// <summary>A malformed body — 400.</summary>
    Invalid,

    /// <summary>A wrong or unconfigured bootstrap secret — the bare 404.</summary>
    Rejected,

    /// <summary>The organization name is taken — 409.</summary>
    Conflict,

    /// <summary>No frontend base URL is configured, so no link can be built — 503.</summary>
    Unavailable,
}

/// <summary>The result of an <see cref="OpsOrganizationService"/> call.</summary>
public sealed class OpsOrganizationResult
{
    private OpsOrganizationResult(OpsOrganizationOutcome outcome, CreatedOrganizationDto? organization, string? error)
    {
        Outcome = outcome;
        Organization = organization;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public OpsOrganizationOutcome Outcome { get; }

    /// <summary>The provisioned organization on <see cref="OpsOrganizationOutcome.Created"/>.</summary>
    public CreatedOrganizationDto? Organization { get; }

    /// <summary>The error code (400 / 409 / 503).</summary>
    public string? Error { get; }

    /// <summary>A success.</summary>
    /// <param name="organization">The provisioned organization.</param>
    /// <returns>The result.</returns>
    public static OpsOrganizationResult Created(CreatedOrganizationDto organization) => new(OpsOrganizationOutcome.Created, organization, null);

    /// <summary>A 400.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static OpsOrganizationResult Invalid(string error) => new(OpsOrganizationOutcome.Invalid, null, error);

    /// <summary>The bare 404.</summary>
    /// <returns>The result.</returns>
    public static OpsOrganizationResult Rejected() => new(OpsOrganizationOutcome.Rejected, null, null);

    /// <summary>A 409.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static OpsOrganizationResult Conflict(string error) => new(OpsOrganizationOutcome.Conflict, null, error);

    /// <summary>A 503.</summary>
    /// <returns>The result.</returns>
    public static OpsOrganizationResult Unavailable() =>
        new(OpsOrganizationOutcome.Unavailable, null, Org.PeopleDirectory.OrgInviteService.LinkUnavailableError);

    /// <inheritdoc />
    public override string ToString() => $"OpsOrganizationResult {{ Outcome = {Outcome} }}";
}
