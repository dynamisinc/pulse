namespace Pulse.WebApi.Features.Org.PeopleDirectory;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// One page of the org directory (<c>GET /api/org/people</c>, identity-auth-roles/19). Staff world only (XC-002): a
/// directory of the caller's OWN organization's people, never projected onto any participant surface.
/// </summary>
public sealed class OrgPeoplePageDto
{
    /// <summary>The people on this page, ordered by display name then id.</summary>
    [JsonPropertyName("items")]
    public required IReadOnlyList<OrgPersonDto> Items { get; init; }

    /// <summary>The 1-based page number that was served.</summary>
    [JsonPropertyName("page")]
    public required int Page { get; init; }

    /// <summary>The page size that was served.</summary>
    [JsonPropertyName("pageSize")]
    public required int PageSize { get; init; }

    /// <summary>The number of people matching the search across all pages.</summary>
    [JsonPropertyName("total")]
    public required int Total { get; init; }
}

/// <summary>
/// One person of the caller's organization, as the org directory shows them (identity-auth-roles/19). Carries no
/// credential material of any kind (no hash, no token, no failed-login count) — only the person's state.
/// </summary>
public sealed class OrgPersonDto
{
    /// <summary>The person id (also the staff-facet id, shared key).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>The normalized email, or <c>null</c> for a legacy person not yet invited.</summary>
    [JsonPropertyName("email")]
    public required string? Email { get; init; }

    /// <summary>The org-level grant: <c>"orgAdmin"</c> or <c>null</c>.</summary>
    [JsonPropertyName("orgRole")]
    public required string? OrgRole { get; init; }

    /// <summary>Whether the person is disabled (sign-in refused, every session revoked).</summary>
    [JsonPropertyName("disabled")]
    public required bool Disabled { get; init; }

    /// <summary>The server wall-clock instant (round-trip <c>"O"</c>) the person was disabled, or <c>null</c>. Staff world.</summary>
    [JsonPropertyName("disabledAt")]
    public required string? DisabledAt { get; init; }

    /// <summary>
    /// The server wall-clock instant (round-trip <c>"O"</c>) until which sign-in is locked out after failed attempts, or
    /// <c>null</c> when the person is not locked out NOW (a lapsed lockout reads <c>null</c>). Staff world.
    /// </summary>
    [JsonPropertyName("lockedOutUntil")]
    public required string? LockedOutUntil { get; init; }

    /// <summary>The person's live (not revoked) enrollments in the organization's exercises.</summary>
    [JsonPropertyName("enrollments")]
    public required IReadOnlyList<OrgPersonEnrollmentDto> Enrollments { get; init; }
}

/// <summary>One line of a person's enrollments summary.</summary>
public sealed class OrgPersonEnrollmentDto
{
    /// <summary>The exercise id.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The exercise name.</summary>
    [JsonPropertyName("exerciseName")]
    public required string ExerciseName { get; init; }

    /// <summary>The role held in that exercise (<c>planner</c> / <c>controller</c> / <c>evaluator</c> / <c>participant</c> / <c>pio</c>).</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>Whether this is the exercise's lead controller enrollment.</summary>
    [JsonPropertyName("isLead")]
    public required bool IsLead { get; init; }
}

/// <summary>
/// The body of <c>PATCH /api/org/people/{personId}</c>. Exactly ONE member must be present: <see cref="IsOrgAdmin"/>
/// grants (<c>true</c>) or revokes (<c>false</c>) the org-admin grant; <see cref="Disabled"/> disables (<c>true</c>) or
/// enables (<c>false</c>) the person. Nullable members, so a missing field is a validation <c>400</c>, never a
/// deserialization failure.
/// </summary>
public sealed class UpdateOrgPersonRequest
{
    /// <summary>Grant (<c>true</c>) or revoke (<c>false</c>) <c>OrgRole = orgAdmin</c>.</summary>
    [JsonPropertyName("isOrgAdmin")]
    public bool? IsOrgAdmin { get; init; }

    /// <summary>Disable (<c>true</c>) or enable (<c>false</c>) the person.</summary>
    [JsonPropertyName("disabled")]
    public bool? Disabled { get; init; }
}

/// <summary>The error body of the org-people routes: <c>{ "error": "&lt;code&gt;" }</c>.</summary>
public sealed class OrgPeopleErrorDto
{
    /// <summary>The error code.</summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }
}
