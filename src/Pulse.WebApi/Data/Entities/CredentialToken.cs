namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The closed vocabulary of <see cref="CredentialToken.Purpose"/> (ADMIN-IDENTITY-MODEL §3.3). The database enforces
/// the same set with <c>CK_CredentialTokens_Purpose</c>.
/// </summary>
public static class CredentialTokenPurposes
{
    /// <summary>An invitation to set a first password (lifetime 7 days).</summary>
    public const string Invite = "invite";

    /// <summary>A password reset (lifetime 60 minutes).</summary>
    public const string Reset = "reset";

    /// <summary>Whether <paramref name="purpose"/> is one of the two defined purposes (exact, lower-case).</summary>
    /// <param name="purpose">A purpose value.</param>
    /// <returns><c>true</c> for <see cref="Invite"/> or <see cref="Reset"/>.</returns>
    public static bool IsDefined(string? purpose) =>
        string.Equals(purpose, Invite, StringComparison.Ordinal) || string.Equals(purpose, Reset, StringComparison.Ordinal);
}

/// <summary>
/// One single-use invite or reset token (ADMIN-IDENTITY-MODEL §3.3, identity-auth-roles/21). Only the SHA-256 hash
/// of the raw token is stored (NFR-009); the raw value is returned once, at issue, and never persisted or logged.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tenant tier: <see cref="IOrganizationOwned"/>, a RESOLUTION ROOT — not centrally filtered</b> (design doc §7.4:
/// "unscoped resolution root, carrying <c>OrganizationId</c> and checked on redemption"). Redeeming a token is a
/// pre-auth lookup by <see cref="TokenHash"/> that DISCOVERS the tenant, exactly like <see cref="LoginChoice"/> and
/// <see cref="ParticipantLink"/>, so a tenant filter here would be a deadlock. Every other read is bounded with
/// <see cref="OrganizationScope.InOrganization{TEntity}"/>, and the write-guard refuses an empty
/// <see cref="OrganizationId"/>. The person or account the token resolves to is then read inside
/// <see cref="OrganizationId"/>, so a token can never act across tenants.
/// </para>
/// <para>
/// <b>Not <see cref="IExerciseScoped"/></b>: a staff reset belongs to a person, who spans exercises. Staff-world only
/// (XC-002); nothing here is projected onto a participant surface.
/// </para>
/// <para>
/// <b>Database rules.</b> The hash is unique; the purpose is checked; exactly one of <see cref="PersonId"/> /
/// <see cref="AccountId"/> is set (<c>CK_CredentialTokens_OneSubject</c>). Every foreign key is <c>Restrict</c>.
/// A token that was VOIDED (a newer token of the same purpose was issued, or the credential changed) carries
/// <see cref="UsedAt"/> too: either way it can never be redeemed again.
/// </para>
/// </remarks>
public sealed class CredentialToken : IOrganizationOwned
{
    /// <summary>The schema bound of <see cref="TokenHash"/> (a hex SHA-256 is 64 characters).</summary>
    public const int MaxTokenHashLength = 64;

    /// <summary>The schema bound of <see cref="Purpose"/>.</summary>
    public const int MaxPurposeLength = 16;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The upper-case hex SHA-256 of the raw token. Unique; the redemption lookup key.</summary>
    public required string TokenHash { get; set; }

    /// <summary>The purpose: <see cref="CredentialTokenPurposes.Invite"/> or <see cref="CredentialTokenPurposes.Reset"/>.</summary>
    public required string Purpose { get; set; }

    /// <summary>The directory <see cref="Person"/> the token sets a password for, or <c>null</c> for a one-off account.</summary>
    public Guid? PersonId { get; set; }

    /// <summary>The one-off participant <see cref="Account"/> the token is for, or <c>null</c> for a person.</summary>
    public Guid? AccountId { get; set; }

    /// <summary>The owning customer tenant (COR-010). Non-nullable; server-stamped from the subject's own organization.</summary>
    public Guid OrganizationId { get; set; }

    /// <summary>Wall-clock instant (UTC) after which the token is refused.</summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Wall-clock instant (UTC) the token was redeemed or voided, or <c>null</c> while it is outstanding.</summary>
    public DateTimeOffset? UsedAt { get; set; }

    /// <summary>The person who issued the token (an admin reset), or <c>null</c> (self-service or system issue).</summary>
    public Guid? IssuedByPersonId { get; set; }

    /// <summary>Server wall-clock instant (UTC) the token was issued.</summary>
    public DateTimeOffset CreatedAt { get; set; }
}
