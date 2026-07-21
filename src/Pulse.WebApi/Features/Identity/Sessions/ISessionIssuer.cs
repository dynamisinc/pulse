namespace Pulse.WebApi.Features.Identity.Sessions;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// The session-issuance seam every login method mints a session through (COR-012): participant login
/// (story 02), staff login (story 05) and shared read-only login (story 06) all call
/// <see cref="IssueAsync"/> with an already-RESOLVED identity + exercise + role. Story 03 owns the single
/// implementation (token/refresh lifecycle, the auth scheme, persistence of the <see cref="Session"/> row)
/// plus the <c>/session</c>, <c>/auth/refresh</c> and <c>/auth/logout</c> endpoints. Wave-0 freezes the seam
/// only — no implementation.
/// </summary>
/// <remarks>
/// The caller is responsible for authenticating the principal FIRST; this seam does not verify credentials.
/// Server-authoritative stamping (issued-at, expiry, the generated token) is the implementation's job — the
/// raw token + refresh material are returned to the caller exactly once (in <see cref="SessionIssueResult"/>)
/// and never persisted in the clear (NFR-009).
/// </remarks>
public interface ISessionIssuer
{
    /// <summary>
    /// Issues and persists a new short-lived <see cref="Session"/> for a resolved identity.
    /// </summary>
    /// <param name="request">The resolved identity + bound exercise + role + kind to issue a session for.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The persisted session plus the raw token/refresh material to hand to the client once.</returns>
    Task<SessionIssueResult> IssueAsync(
        SessionIssueRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The resolved-identity input to <see cref="ISessionIssuer.IssueAsync"/>. The caller has already
/// authenticated the principal and resolved the bound exercise (host-resolved for participants, story 08;
/// active-exercise selection for staff, story 05); this carries exactly what the session row needs.
/// </summary>
public sealed class SessionIssueRequest
{
    /// <summary>The bound exercise run (COR-012). For a participant this must equal the host-resolved exercise (story 08).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The session kind — <c>participant</c> / <c>staff</c> / <c>readonly</c> (matches <c>Session.Kind</c>).</summary>
    public required string Kind { get; init; }

    /// <summary>The <c>ExerciseRole</c> string for the session (matches the frozen <c>Session.role</c> vocabulary).</summary>
    public required string Role { get; init; }

    /// <summary>The canonical principal id that surfaces as the frozen <c>Session.accountId</c> (account id / staff user id / ephemeral id).</summary>
    public required string PrincipalId { get; init; }

    /// <summary>The per-human attribution id (COR-018) that surfaces as the frozen <c>Session.actingHumanId</c>; the ephemeral identity for a read-only session.</summary>
    public required string ActingHumanId { get; init; }

    /// <summary>Whether this is a view-only session (COR-015).</summary>
    public required bool IsReadOnly { get; init; }

    /// <summary>The bound participant <c>Account</c> id, or <c>null</c> for staff / read-only sessions.</summary>
    public Guid? AccountId { get; init; }

    /// <summary>The bound <c>StaffUser</c> id, or <c>null</c> for participant / read-only sessions.</summary>
    public Guid? StaffUserId { get; init; }

    /// <summary>The bound persona id, or <c>null</c> when absent (surfaces as the OPTIONAL frozen <c>Session.personaId</c>).</summary>
    public Guid? PersonaId { get; init; }
}

/// <summary>
/// The result of <see cref="ISessionIssuer.IssueAsync"/>: the persisted <see cref="Session"/> plus the RAW
/// token/refresh material handed to the client exactly once (only the hashes are persisted, NFR-009).
/// </summary>
public sealed class SessionIssueResult
{
    /// <summary>The persisted session row (server-stamped issued-at / expiry / bound identity).</summary>
    public required Session Session { get; init; }

    /// <summary>The raw opaque session token to hand to the client; only its hash is stored (<c>Session.TokenHash</c>).</summary>
    public required string SessionToken { get; init; }

    /// <summary>The raw refresh token to hand to the client, or <c>null</c> when the session has no refresh material; only its hash is stored.</summary>
    public string? RefreshToken { get; init; }
}
