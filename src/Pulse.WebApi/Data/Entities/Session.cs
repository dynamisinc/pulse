namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A persisted, server-side session (COR-012) — the durable anchor of the exercise scope the isolation
/// guarantee relies on. Every login method (participant story 02, staff story 05, shared read-only story 06)
/// mints one of these through the story-03 issuance service; <c>GET /api/session</c> projects it to the
/// frozen <c>Session</c> wire shape. Persisting it server-side is what makes logout, refresh, and story-07
/// revoke-all real: a stolen reference cannot be replayed once the row is revoked.
/// </summary>
/// <remarks>
/// <para>
/// <b>Deliberately NOT <see cref="IExerciseScoped"/> (schema decision — confirmed against story 03).</b> A
/// session is looked up by its opaque token during pre-auth and refresh, at a point when NO exercise scope
/// has been resolved yet (<c>ExerciseContext.CurrentExerciseId</c> is still unset → fail-closed
/// <see cref="Guid.Empty"/>). If <see cref="Session"/> implemented the marker, the B0 global query filter
/// would confine the lookup to the current scope and, pre-resolution, match ZERO rows — the token lookup
/// could never find the very session that RESOLVES the scope. It therefore carries its bound
/// <see cref="ExerciseId"/> as a PLAIN column, and the Wave-2 issuance/validation logic enforces that a
/// participant session's bound exercise equals the host-resolved exercise (a mismatch fails closed, story 08
/// precedence). Unscoped is safe for the same reason as <see cref="StaffUser"/>: a session row is an
/// auth-layer access record with no participant-visible content (XC-002), read only by the auth pipeline.
/// </para>
/// <para>
/// <b>Wave-0 schema freeze.</b> This freezes the COMPLETE column set; the auth scheme, issuance, refresh,
/// expiry, and revoke-all BEHAVIOUR are stories 03/07. No secret is stored in the clear — <see cref="TokenHash"/>
/// and <see cref="RefreshTokenHash"/> hold a hash of the opaque reference handed to the browser, never the
/// raw token; nothing here is logged (NFR-004 / NFR-009).
/// </para>
/// </remarks>
public sealed class Session
{
    /// <summary>Primary key (the internal session id; distinct from the opaque token handed to the client).</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// A hash of the opaque session token/reference presented by the client — the lookup key on every
    /// authenticated request. Unique. The RAW token is never persisted (NFR-009): the pipeline hashes the
    /// presented token and looks up by this value.
    /// </summary>
    public required string TokenHash { get; set; }

    /// <summary>
    /// A hash of the refresh token (story 03 refresh path), or <c>null</c> when the session has no active
    /// refresh material. Unique WHEN present (filtered unique index). Raw refresh tokens are never persisted.
    /// </summary>
    public string? RefreshTokenHash { get; set; }

    /// <summary>
    /// The session kind — <c>participant</c> (named account, story 02) / <c>staff</c> (IdP identity, story 05)
    /// / <c>readonly</c> (shared view-only, story 06) — stored verbatim as a string. Drives issuance and the
    /// story-07 revoke-all-read-only query (<c>Kind == "readonly"</c>).
    /// </summary>
    public required string Kind { get; set; }

    /// <summary>
    /// The bound exercise (COR-012) — a PLAIN column, not the <see cref="IExerciseScoped"/> marker (see the
    /// type remarks for why). Projects onto the frozen <c>Session.exerciseId</c> wire field. For a
    /// participant this must equal the host-resolved exercise (story 08); for staff it is the selected
    /// active exercise (story 05). Indexed for the revoke-all-by-exercise query (story 07).
    /// </summary>
    public Guid ExerciseId { get; set; }

    /// <summary>
    /// The canonical principal identifier that projects onto the frozen <c>Session.accountId</c> wire field,
    /// uniform across all three kinds: the <see cref="Account"/> id (participant), the <see cref="StaffUser"/>
    /// id (staff), or the generated EPHEMERAL identity (read-only, COR-015 — no named account). Kept as the
    /// single wire-facing id so the DTO factory never branches on kind; the typed nullable ids below preserve
    /// the referential link where one exists.
    /// </summary>
    public required string PrincipalId { get; set; }

    /// <summary>The bound participant <see cref="Account"/> for a <c>participant</c> session; <c>null</c> for staff / read-only. Logical id reference (no navigation).</summary>
    public Guid? AccountId { get; set; }

    /// <summary>The bound <see cref="StaffUser"/> for a <c>staff</c> session; <c>null</c> for participant / read-only. Logical id reference (no navigation).</summary>
    public Guid? StaffUserId { get; set; }

    /// <summary>
    /// The session's role — the <c>ExerciseRole</c> union value as a string, projecting onto the frozen
    /// <c>Session.role</c> wire field. For staff it is the role of the selected active-exercise assignment.
    /// </summary>
    public required string Role { get; set; }

    /// <summary>
    /// The persona the session posts as, or <c>null</c> when absent (staff sessions have no persona) —
    /// mirrors the OPTIONAL <c>Session.personaId</c> wire field (omitted, not null, when absent). Logical id
    /// reference (no navigation).
    /// </summary>
    public Guid? PersonaId { get; set; }

    /// <summary>
    /// The individual human behind the session for per-human attribution (COR-018), projecting onto the
    /// frozen <c>Session.actingHumanId</c> wire field. Always set at issuance: the account's/staff user's
    /// human id, or the generated ephemeral identity for a read-only session (COR-015). Telemetry-bearing.
    /// </summary>
    public required string ActingHumanId { get; set; }

    /// <summary>Whether this is a view-only session (COR-015) — projects onto the frozen <c>Session.isReadOnly</c> wire field; write paths are denied server-side for a read-only session (story 06).</summary>
    public bool IsReadOnly { get; set; }

    /// <summary>Server wall-clock instant the session was issued (UTC).</summary>
    public DateTimeOffset IssuedAt { get; set; }

    /// <summary>
    /// Wall-clock expiry of the session (short-lived, COR-012) — projects onto the frozen
    /// <c>Session.expiresAt</c> wire field (ISO-8601 round-trip). Auth lifetime is a REAL-time concern, never
    /// scenario time; past expiry forces re-auth and <c>GET /api/session</c> returns 401.
    /// </summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Wall-clock expiry of the refresh window (story 03), or <c>null</c> when the session has no refresh material.</summary>
    public DateTimeOffset? RefreshExpiresAt { get; set; }

    /// <summary>
    /// Wall-clock instant the session was invalidated server-side (logout, story 03; revoke-all, story 07),
    /// or <c>null</c> while live. Non-<c>null</c> means the reference can no longer be replayed — the whole
    /// reason sessions are persisted rather than stateless.
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }
}
