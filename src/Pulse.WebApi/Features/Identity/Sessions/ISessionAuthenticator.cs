namespace Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Resolves the LIVE session a presented opaque token authenticates, for the request-scope session middleware
/// (<see cref="SessionAuthenticationMiddleware"/>). This is the session analogue of
/// <c>IHostExerciseResolver</c>: a stateless seam whose implementation opens its OWN short-lived DI scope for
/// the token lookup, so the middleware never touches the request-scoped <c>PulseDbContext</c> before it has
/// written the scope (the always-Critical precedence-correctness point — see the middleware remarks).
/// </summary>
/// <remarks>
/// Fail closed: returns <c>null</c> for an absent/unknown token, a revoked or expired session, or any lookup
/// error. A <c>null</c> result means "this request presents no live session"; the middleware then leaves the
/// scope at whatever host resolution set (or unset), never honoring the token.
/// </remarks>
public interface ISessionAuthenticator
{
    /// <summary>Resolves the live session for a presented raw token, or <c>null</c> when none (fail closed).</summary>
    /// <param name="rawToken">The raw opaque token presented on the request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The authenticated session's scope-relevant facts, or <c>null</c>.</returns>
    Task<AuthenticatedSession?> AuthenticateAsync(string rawToken, CancellationToken cancellationToken);
}

/// <summary>
/// The minimum a request-scope decision needs about the authenticated session — no token / secret material
/// (NFR-009). The bound <see cref="ExerciseId"/> is what the middleware writes into the scope; <see cref="Kind"/>
/// drives the per-kind host-binding rule (participant sessions are host-bound, staff / read-only are not);
/// <see cref="StaffUserId"/> lets a staff-only downstream identify the caller.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why the attribution fields are here (identity-auth-roles/13, #362).</b>
/// <see cref="PrincipalId"/>, <see cref="ActingHumanId"/> and <see cref="PersonaId"/> are the identity facts
/// <c>POST /api/telemetry</c> must STAMP rather than believe from an event envelope. They are carried on this
/// type — and projected onto the principal by <see cref="SessionPrincipal"/> — precisely so that stamping them
/// costs no additional database work: <see cref="ISessionAuthenticator"/> already reads the whole
/// <c>Session</c> row once per request, and telemetry is a burst-rate endpoint (SOC-071) where a second
/// token→session lookup per event would be a self-inflicted load multiplier. They are deliberately NOT a
/// fourth session-lookup seam; the three endpoint-time accessors
/// (<c>ICurrentStaffSessionAccessor</c> / <c>ICurrentSessionPersonaAccessor</c> / <c>IReadOnlySessionProbe</c>)
/// are unchanged, and consolidating those remains its own follow-up.
/// </para>
/// <para>
/// <see cref="PrincipalId"/> and <see cref="ActingHumanId"/> are <c>required</c> on purpose: the persisted
/// <c>Session</c> always carries both, and a resolver (or test double) that silently defaulted them would make
/// a downstream attribution check pass while attributing nothing — the exact failure mode #359's suite had.
/// </para>
/// </remarks>
public sealed class AuthenticatedSession
{
    /// <summary>The persisted <c>Session.Id</c> of the authenticated session.</summary>
    public required Guid SessionId { get; init; }

    /// <summary>The session's bound exercise (COR-012) — the scope the middleware writes with precedence over the host.</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The session kind — <c>participant</c> / <c>staff</c> / <c>readonly</c>.</summary>
    public required string Kind { get; init; }

    /// <summary>The bound <c>StaffUser</c> id for a staff session; <c>null</c> for participant / read-only.</summary>
    public Guid? StaffUserId { get; init; }

    /// <summary>
    /// The session's <c>PrincipalId</c> — the participant <c>Account</c> id for a participant session, and the
    /// telemetry envelope's <c>actor.participantId</c> for that session. Never a secret (NFR-009).
    /// </summary>
    public required string PrincipalId { get; init; }

    /// <summary>
    /// The individual human behind the session (COR-018) — the telemetry envelope's
    /// <c>actor.actingHumanId</c>. The one attribution field the 2026-07-25 audit proved forgeable.
    /// </summary>
    public required string ActingHumanId { get; init; }

    /// <summary>
    /// The session's persona binding, or <c>null</c> for a session with none (every staff and shared
    /// read-only session today, and a participant account whose persona has not been bound).
    /// </summary>
    public Guid? PersonaId { get; init; }
}
