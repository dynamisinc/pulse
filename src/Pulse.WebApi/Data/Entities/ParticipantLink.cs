namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A participant's personal sign-in link (easy-login EL-5): the bearer credential behind
/// <c>{FrontendBaseUrl}/join/{token}</c>. Exactly ONE row per account (the unique
/// <c>(ExerciseId, AccountId)</c> index in <c>PulseDbContext.OnModelCreating</c>); a reissue rotates the token
/// IN PLACE (new hash, new protected copy, <see cref="Generation"/> + 1) rather than adding a row, so "the old
/// link stops working" is the same single hash lookup as "an unknown link".
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-001).</b> Belongs to exactly one exercise run, so it is
/// <see cref="IExerciseScoped"/> with a non-nullable <see cref="ExerciseId"/>: the central read-side query filter
/// and the write-time guard in <c>PulseDbContext</c> cover it with no per-entity code. A token minted in
/// exercise B and presented on exercise A's host hashes to a row the filter hides, so it is simply not found.
/// </para>
/// <para>
/// <b>The raw token is never stored.</b> <see cref="TokenHash"/> is <c>SessionTokens.Hash</c> of it (the lookup
/// key; a 128-bit random token needs no slow KDF), and <see cref="ProtectedToken"/> is an ASP.NET Data
/// Protection ciphertext of it so staff can reprint and copy the same link (EL-5). A revoke clears the protected
/// copy. If the key ring is lost the copy no longer decrypts and the roster reports <c>needsReissue</c>, never a
/// 500. Neither column is ever projected to a participant, logged, or put in telemetry (NFR-009).
/// </para>
/// <para>
/// <see cref="AccountId"/> is a LOGICAL reference with no foreign key (house style — <c>Follow</c>,
/// <c>PostReaction.PersonaId</c>): readers join explicitly through the exercise-scoped <c>Accounts</c> set.
/// </para>
/// </remarks>
public sealed class ParticipantLink : IExerciseScoped
{
    /// <summary>Maximum length of <see cref="TokenHash"/>: the 64-character uppercase-hex SHA-256 of the raw token.</summary>
    public const int MaxTokenHashLength = 64;

    /// <summary>Maximum length of <see cref="ProtectedToken"/> (a Data Protection payload for a 22-character token is far shorter).</summary>
    public const int MaxProtectedTokenLength = 512;

    /// <summary>Primary key. Also the telemetry target id (<c>participantLink</c>).</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The participant <see cref="Account"/> this link signs in as. Unique per exercise (one link per account).</summary>
    public Guid AccountId { get; set; }

    /// <summary>
    /// <c>SessionTokens.Hash</c> of the raw token (64-character uppercase hex). Globally unique: the lookup key a
    /// join request is matched by. Retained after a revoke, so a revoked token resolves to a revoked row (401)
    /// through the same single lookup as an unknown one.
    /// </summary>
    public required string TokenHash { get; set; }

    /// <summary>
    /// The raw token encrypted with ASP.NET Data Protection (<c>IParticipantLinkTokenProtector</c>), so staff can
    /// rebuild the join URL to reprint or copy it. <c>null</c> after a revoke. Staff-only; never logged.
    /// </summary>
    public string? ProtectedToken { get; set; }

    /// <summary>How many times the token has been issued for this account: 1 for the first link, + 1 on each reissue.</summary>
    public int Generation { get; set; }

    /// <summary>Server wall-clock instant the current token was issued (UTC).</summary>
    public DateTimeOffset IssuedAt { get; set; }

    /// <summary>The <see cref="StaffUser"/> who issued the current token, or <c>null</c> when it was issued by provisioning.</summary>
    public Guid? IssuedByStaffUserId { get; set; }

    /// <summary>Server wall-clock instant the link was revoked, or <c>null</c> while it is active.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>The <see cref="StaffUser"/> who revoked the link, or <c>null</c>.</summary>
    public Guid? RevokedByStaffUserId { get; set; }

    /// <summary>Server wall-clock instant of the last successful join with this link, or <c>null</c> if never used.</summary>
    public DateTimeOffset? LastUsedAt { get; set; }

    /// <summary>How many successful joins this link has served. Defaults to 0.</summary>
    public int UseCount { get; set; }
}
