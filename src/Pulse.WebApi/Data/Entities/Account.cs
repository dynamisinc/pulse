namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A provisioned, named participant account (COR-011) — the identity an active participant (PIO, comms
/// player) authenticates as. Belongs to exactly ONE exercise run (COR-004), so it is
/// <see cref="IExerciseScoped"/> with a non-nullable <see cref="ExerciseId"/> and is covered by the B0
/// read-side global query filter + write-time guard automatically. There is no self-registration: accounts
/// are created by planners (bulk CSV import or individual create, story 02) in the staff world only (XC-002).
/// </summary>
/// <remarks>
/// <para>
/// <b>Wave-0 schema freeze.</b> This entity freezes the COMPLETE column set stories 02 (provisioning +
/// participant login) and 07 (lockout) will need; the behaviour (import, hashing, login, telemetry, lockout)
/// is later waves. No credential is ever stored in the clear — <see cref="CredentialHash"/> holds an
/// ASP.NET Core <c>PasswordHasher&lt;T&gt;</c>-format hash, never a reversible secret (NFR-004).
/// </para>
/// <para>
/// <b>Reserved nullable columns (roadmap R6).</b> <see cref="ActingHumanId"/>, <see cref="CredentialHash"/>,
/// <see cref="LastLoginAt"/>, <see cref="FailedLoginCount"/> and <see cref="LockedOutUntil"/> are frozen now
/// (a fan-out wave adds NO migration) but populated by later waves — kept nullable / defaulted where a value
/// may be absent at provisioning time.
/// </para>
/// </remarks>
public sealed class Account : IExerciseScoped
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// The owning exercise run (COR-001 / COR-004). Non-nullable; the write-guard rejects
    /// <see cref="Guid.Empty"/>. An account belongs to exactly one exercise, so a participant login on
    /// exercise A's host can only ever match an A account.
    /// </summary>
    public Guid ExerciseId { get; set; }

    /// <summary>
    /// The login handle the participant authenticates with. Unique WITHIN an exercise (see the
    /// <c>(ExerciseId, Username)</c> unique index in <c>PulseDbContext.OnModelCreating</c>) — never globally,
    /// so two exercises may reuse the same handle without colliding.
    /// </summary>
    public required string Username { get; set; }

    /// <summary>
    /// Display name shown on the staff console AND on participant surfaces — a stored-XSS surface (COR-007),
    /// so story 02 HTML-sanitizes it on ingest (strip, not encode) before it is ever persisted.
    /// </summary>
    public required string DisplayName { get; set; }

    /// <summary>
    /// The account's role for this exercise — the <c>ExerciseRole</c> union value as a string
    /// (<c>participant</c> / <c>pio</c> / <c>controller</c> / <c>evaluator</c> / <c>planner</c> /
    /// <c>orgAdmin</c>), stored VERBATIM as the frozen frontend vocabulary (<c>core/auth/roles.ts</c>) so it
    /// flows onto the frozen <c>Session.role</c> wire field with no case-mapping. Matches the house pattern
    /// for frontend-union columns (<see cref="Persona.Kind"/>, <see cref="Post.Origin"/>).
    /// </summary>
    public required string Role { get; set; }

    /// <summary>
    /// The <see cref="Persona"/> this account posts as, or <c>null</c> when the account has no bound persona
    /// (e.g. a staff-adjacent role). Nullable to mirror the optional <c>Session.personaId</c> wire field. A
    /// plain id reference (no navigation), matching <see cref="Persona.PersonaTemplateId"/>.
    /// </summary>
    public Guid? PersonaId { get; set; }

    /// <summary>
    /// The individual human behind the (possibly shared) account for per-human attribution (COR-018).
    /// Reserved nullable: for a 1:1 named account the session issuer may derive it from the account id when
    /// unset; story 09 (org accounts, deferred) populates it explicitly. Staff/telemetry-only (XC-002).
    /// </summary>
    public string? ActingHumanId { get; set; }

    /// <summary>
    /// The hashed login credential — an ASP.NET Core <c>PasswordHasher&lt;Account&gt;</c>-format hash, NEVER
    /// plaintext and never a reversible secret (NFR-004); never logged or returned on any response. Nullable:
    /// an account may be provisioned before a credential is set (Cadence-style import + separate credential
    /// delivery); login requires it to be present.
    /// </summary>
    public string? CredentialHash { get; set; }

    /// <summary>Server wall-clock instant the account was provisioned (UTC). Staff/telemetry-only.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Reserved (story 02): wall-clock instant of the last successful login, or <c>null</c> if never. Telemetry-only.</summary>
    public DateTimeOffset? LastLoginAt { get; set; }

    /// <summary>Reserved (story 07): consecutive failed-login count driving brute-force lockout. Defaults to 0.</summary>
    public int FailedLoginCount { get; set; }

    /// <summary>Reserved (story 07): wall-clock instant until which the account is locked out, or <c>null</c> when not locked.</summary>
    public DateTimeOffset? LockedOutUntil { get; set; }

    // ------------------------------------------------------------------------------------------------------
    // easy-login/01 (EL-1, EL-4, EL-8): additive roster columns. Every one is nullable or defaulted, so an
    // account created before them (legacy import, bootstrap) reads null/false and keeps signing in exactly as it
    // did with its password.
    // ------------------------------------------------------------------------------------------------------

    /// <summary>Maximum length of <see cref="Agency"/>.</summary>
    public const int MaxAgencyLength = 128;

    /// <summary>Maximum length of <see cref="JobRole"/>.</summary>
    public const int MaxJobRoleLength = 128;

    /// <summary>Maximum length of <see cref="Email"/> (the RFC 5321 path limit).</summary>
    public const int MaxEmailLength = 254;

    /// <summary>
    /// The participant's agency as free text from the roster (sanitized on ingest), or <c>null</c>. Staff-only:
    /// shown in the roster and on the printed card, never on a participant projection.
    /// </summary>
    public string? Agency { get; set; }

    /// <summary>
    /// The free-text job label from the roster CSV's <c>role</c> column ("EOC Liaison"), or <c>null</c>. NOT an
    /// <c>ExerciseRole</c>: that is <see cref="Role"/> (EL-1). Staff-only.
    /// </summary>
    public string? JobRole { get; set; }

    /// <summary>
    /// The participant's email address, or <c>null</c>. Staff-only (XC-002): it appears on no participant
    /// projection, telemetry payload, log line or error body.
    /// </summary>
    public string? Email { get; set; }

    /// <summary>
    /// Wall-clock instant staff disabled this person (EL-8), or <c>null</c> while enabled. A disabled account is
    /// refused by every participant sign-in path (link, day word and password).
    /// </summary>
    public DateTimeOffset? DisabledAt { get; set; }

    /// <summary>
    /// Whether <see cref="PersonaId"/> is the citizen persona the roster auto-created for this person (EL-4), as
    /// opposed to a bound org persona or a seeded one. Defaults to <c>false</c>.
    /// </summary>
    public bool PersonaAutoCreated { get; set; }
}
