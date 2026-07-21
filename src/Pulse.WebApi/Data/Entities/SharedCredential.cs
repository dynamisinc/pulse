namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The shared, view-only credential for one exercise (COR-015) — the "URL + shared password" that grants a
/// read-only session to the hundred-passive-participants case, with no per-user provisioning. Belongs to
/// exactly ONE exercise, so it is <see cref="IExerciseScoped"/> (non-nullable <see cref="ExerciseId"/>,
/// covered by the B0 global query filter + write-guard). Exactly one row per exercise — enforced by the
/// unique index on <see cref="ExerciseId"/> in <c>PulseDbContext.OnModelCreating</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Wave-0 schema freeze.</b> This freezes the COMPLETE column set for BOTH story 06 (the credential +
/// view-only login) AND story 07 (lifecycle: rotation-with-grace, immediate revoke, brute-force lockout,
/// per-IP rate limit). The lifecycle LOGIC is Wave 4 — but the columns it needs are frozen here because a
/// fan-out wave adds no migration.
/// </para>
/// <para>
/// The password is only ever stored hashed (<see cref="CurrentHash"/> / <see cref="PreviousHash"/> hold an
/// ASP.NET Core <c>PasswordHasher&lt;T&gt;</c>-format hash) — never plaintext, never logged, never returned
/// (NFR-004 / NFR-009). Internet-facing shared secret: reviewed as Tier-2.
/// </para>
/// </remarks>
public sealed class SharedCredential : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.
    /// Unique — one shared credential per exercise — so exercise A's password can never authenticate on
    /// exercise B's host.
    /// </summary>
    public Guid ExerciseId { get; set; }

    /// <summary>
    /// The current hashed shared password (<c>PasswordHasher&lt;T&gt;</c> format). Nullable so a credential
    /// row may exist while disabled / before a password is first set; a login only succeeds when the
    /// credential is enabled and this is present.
    /// </summary>
    public string? CurrentHash { get; set; }

    /// <summary>
    /// Reserved (story 07 rotation-with-grace): the PREVIOUS hashed password, which still authenticates until
    /// <see cref="PreviousHashGraceExpiresAt"/> passes. <c>null</c> when no rotation grace is active.
    /// </summary>
    public string? PreviousHash { get; set; }

    /// <summary>
    /// Reserved (story 07): wall-clock instant after which <see cref="PreviousHash"/> stops authenticating.
    /// <c>null</c> when no rotation grace is active.
    /// </summary>
    public DateTimeOffset? PreviousHashGraceExpiresAt { get; set; }

    /// <summary>Whether shared read-only access is currently enabled for the exercise (story 06). Defaults to disabled.</summary>
    public bool IsEnabled { get; set; }

    /// <summary>
    /// Reserved (story 07 immediate revoke): wall-clock instant the credential was revoked. Non-<c>null</c>
    /// means revoked — revocation also terminates every active read-only <see cref="Session"/> for the
    /// exercise (Wave-4 logic). <c>null</c> when not revoked.
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Reserved (story 07): consecutive failed shared-login attempts driving brute-force lockout. Defaults to 0.</summary>
    public int FailedAttemptCount { get; set; }

    /// <summary>Reserved (story 07): wall-clock instant until which shared login is locked out, or <c>null</c> when not locked.</summary>
    public DateTimeOffset? LockedOutUntil { get; set; }

    /// <summary>Server wall-clock instant the credential row was created (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Reserved (story 07): wall-clock instant of the last lifecycle change (rotate/revoke/enable), or <c>null</c>.</summary>
    public DateTimeOffset? UpdatedAt { get; set; }
}
