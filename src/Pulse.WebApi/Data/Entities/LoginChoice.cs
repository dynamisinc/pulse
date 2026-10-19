namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The single-use org-choice record for slugless staff sign-in (ADMIN-IDENTITY-MODEL §1.2): when one email's
/// password verifies in more than one organization, the response lists only those orgs and returns a choice token
/// whose SHA-256 hash is stored here. Schema ships in the A1 migration (identity-auth-roles/16); the behaviour is
/// story 15.
/// </summary>
/// <remarks>
/// <b>Deliberately unscoped — a resolution root looked up by <see cref="TokenHash"/></b> before any tenant is
/// known. Its candidates (<see cref="LoginChoiceCandidate"/>) carry the organizations; consuming a choice is one
/// statement guarded by <c>ConsumedAt IS NULL</c>. No raw token is ever persisted (NFR-009).
/// </remarks>
public sealed class LoginChoice
{
    /// <summary>The schema bound of the two hash columns (a hex SHA-256 is 64 characters).</summary>
    public const int MaxHashLength = 64;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The SHA-256 hash of the choice token. Unique.</summary>
    public required string TokenHash { get; set; }

    /// <summary>Wall-clock expiry (two minutes after issue).</summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Wall-clock instant the whole choice was consumed, or <c>null</c> while unused.</summary>
    public DateTimeOffset? ConsumedAt { get; set; }

    /// <summary>A hash of the requesting IP, for audit; never the raw address.</summary>
    public required string CreatedFromIpHash { get; set; }
}

/// <summary>
/// One password-verified candidate of a <see cref="LoginChoice"/> (ADMIN-IDENTITY-MODEL §1.2): the person and the
/// organization the choice may resolve to. Unscoped like its parent; keyed by <c>(ChoiceId, PersonId)</c>.
/// </summary>
public sealed class LoginChoiceCandidate
{
    /// <summary>The owning <see cref="LoginChoice"/>.</summary>
    public Guid ChoiceId { get; set; }

    /// <summary>The <see cref="Person"/> whose password verified.</summary>
    public Guid PersonId { get; set; }

    /// <summary>That person's organization (checked against the chosen slug on redemption).</summary>
    public Guid OrganizationId { get; set; }
}
