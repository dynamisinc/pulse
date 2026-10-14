namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The "password for a day" (easy-login EL-9): one word per exercise per CALENDAR DATE in the exercise time zone
/// (the real date there, never scenario time). A participant signs in with their sign-in name plus the word for
/// today. Exactly one row per <c>(ExerciseId, ForDate)</c> (unique index in <c>PulseDbContext.OnModelCreating</c>);
/// setting a word for a date that already has one replaces it in place (a rotation, <see cref="ReplacedCount"/> + 1).
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-001).</b> <see cref="IExerciseScoped"/> with a non-nullable
/// <see cref="ExerciseId"/>, so the central read filter and write guard cover it: exercise B's word is invisible
/// to (and can never open) exercise A.
/// </para>
/// <para>
/// <b>The word is never stored in the clear.</b> <see cref="WordHash"/> is an <c>ISharedCredentialHasher</c>
/// (PBKDF2, <c>PasswordHasher&lt;T&gt;</c> format) hash of the normalised word. The plaintext is shown to staff
/// once, at set time, and is never logged, re-readable or put in telemetry (NFR-009).
/// </para>
/// </remarks>
public sealed class ExerciseDayWord : IExerciseScoped
{
    /// <summary>Maximum length of <see cref="WordHash"/> (a v3 <c>PasswordHasher</c> hash is 84 characters).</summary>
    public const int MaxWordHashLength = 256;

    /// <summary>Primary key. Also the telemetry target id (<c>dayWord</c>).</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The calendar date in the exercise time zone this word is valid for (SQL <c>date</c>).</summary>
    public DateOnly ForDate { get; set; }

    /// <summary>The slow-KDF hash of the normalised word. Never the plaintext.</summary>
    public required string WordHash { get; set; }

    /// <summary>Server wall-clock instant the current word was set (UTC).</summary>
    public DateTimeOffset SetAt { get; set; }

    /// <summary>The <see cref="StaffUser"/> who set the current word.</summary>
    public Guid SetByStaffUserId { get; set; }

    /// <summary>
    /// How many times the word for this date was replaced after it was first set. Defaults to 0. Also the row's
    /// optimistic-concurrency token (<c>PulseDbContext.OnModelCreating</c>): every rotation increments it, so a rotation
    /// or clear whose read went stale matches no row, and concurrent rotations serialize instead of losing a count
    /// (Copilot review on #486).
    /// </summary>
    public int ReplacedCount { get; set; }
}
