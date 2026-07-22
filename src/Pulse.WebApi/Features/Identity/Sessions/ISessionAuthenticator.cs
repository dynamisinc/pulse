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
}
