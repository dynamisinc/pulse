namespace Pulse.WebApi.Features.Identity.Staff;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/auth/staff/login</c> 200 response when the password verified for MORE than one organization
/// (ADMIN-IDENTITY-MODEL §1.2): <c>{choose: [{slug, orgName}], choiceToken}</c>. It lists only the organizations whose
/// password verified, so it discloses nothing an attacker without the password could learn. No session yet.
/// </summary>
public sealed class StaffLoginChoiceDto
{
    /// <summary>The organizations the caller may choose between (only those whose password verified).</summary>
    [JsonPropertyName("choose")]
    public required IReadOnlyList<StaffLoginChoiceOrgDto> Choose { get; init; }

    /// <summary>The raw single-use, 2-minute choice token (only its SHA-256 hash is stored).</summary>
    [JsonPropertyName("choiceToken")]
    public required string ChoiceToken { get; init; }
}

/// <summary>One organization the caller may choose at sign-in.</summary>
public sealed class StaffLoginChoiceOrgDto
{
    /// <summary>The organization's URL slug — the value <c>/login/choose</c> takes.</summary>
    [JsonPropertyName("slug")]
    public required string Slug { get; init; }

    /// <summary>The organization's display name.</summary>
    [JsonPropertyName("orgName")]
    public required string OrgName { get; init; }
}

/// <summary>
/// The <c>POST /api/auth/staff/login/choose</c> request body. Nullable scalars so a missing field is a 400, never a
/// deserialization failure.
/// </summary>
public sealed class StaffLoginChooseRequest
{
    /// <summary>The raw choice token the login response returned.</summary>
    public string? ChoiceToken { get; init; }

    /// <summary>The slug of the chosen organization — must be one of the choice's candidates.</summary>
    public string? OrgSlug { get; init; }
}
