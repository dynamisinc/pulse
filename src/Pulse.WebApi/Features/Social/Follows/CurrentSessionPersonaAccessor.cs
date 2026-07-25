namespace Pulse.WebApi.Features.Social.Follows;

using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Resolves the persona the CURRENT request's session posts/acts as — the single fact the follow write path
/// keys off, since the follower of a new edge is never a client-supplied id but always the caller's own
/// session-bound persona (<c>Account.PersonaId</c> → <c>Session.PersonaId</c>).
/// </summary>
/// <remarks>
/// Deliberately the same shape as the two session-identity reads already established
/// (<c>CurrentStaffSessionAccessor</c> and <c>ReadOnlySessionProbe</c>): a small endpoint-time re-resolution
/// of the presented opaque token against
/// <c>PulseDbContext.Sessions</c>, behind an interface so the write service is unit-testable. It is NOT a
/// third parallel authentication mechanism — <c>SessionAuthenticationMiddleware</c> remains the thing that
/// authenticates a request and sets its exercise scope; this only reads WHICH persona that already-resolved
/// session is bound to.
/// </remarks>
public interface ICurrentSessionPersonaAccessor
{
    /// <summary>
    /// Returns the current request's session-bound persona, or <c>null</c> when there is none. FAILS CLOSED:
    /// an absent/unknown/expired/revoked token, or a live session with no <c>PersonaId</c> (every staff and
    /// shared read-only session), yields <c>null</c> — never a guessed or defaulted persona.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resolved session persona, or <c>null</c>.</returns>
    Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The session-bound persona identity of the current request — everything the follow write path needs to
/// stamp an edge and its XC-004 event server-side.
/// </summary>
public sealed class CurrentSessionPersona
{
    /// <summary>The persisted session's id.</summary>
    public required Guid SessionId { get; init; }

    /// <summary>The persona the session acts as — the follower on any edge this request creates.</summary>
    public required Guid PersonaId { get; init; }

    /// <summary>
    /// The exercise the session is bound to. Compared against the request's resolved
    /// <see cref="IExerciseContext"/> scope by the write path as defense in depth (COR-001) — the
    /// session middleware already enforces the binding, but a scope/session disagreement must never be
    /// resolved in favour of writing a row.
    /// </summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>
    /// The individual human behind the session (COR-018) — telemetry-only attribution, never projected onto a
    /// participant-facing response (XC-002).
    /// </summary>
    public required string ActingHumanId { get; init; }
}

/// <summary>
/// Default <see cref="ICurrentSessionPersonaAccessor"/> — hashes the presented opaque bearer token, looks the
/// persisted <c>Session</c> up by <c>TokenHash</c> through the request-scoped <see cref="PulseDbContext"/>,
/// and reports its persona only for a LIVE session that actually carries one. Scoped lifetime. No token
/// material is ever logged (NFR-009).
/// </summary>
/// <remarks>
/// <c>Session</c> is deliberately NOT <c>IExerciseScoped</c> (it is looked up pre-scope-resolution), so this
/// lookup is not query-filtered — which is exactly why the consumer re-checks
/// <see cref="CurrentSessionPersona.ExerciseId"/> against the request's resolved scope before writing
/// anything.
/// </remarks>
public sealed class CurrentSessionPersonaAccessor : ICurrentSessionPersonaAccessor
{
    private readonly PulseDbContext _dbContext;
    private readonly IHttpContextAccessor _httpContextAccessor;

    /// <summary>Creates the accessor over its persistence context and the current-request accessor.</summary>
    /// <param name="dbContext">The request-scoped persistence context the token lookup runs through.</param>
    /// <param name="httpContextAccessor">Provides the current request whose <c>Authorization</c> header carries the token.</param>
    public CurrentSessionPersonaAccessor(PulseDbContext dbContext, IHttpContextAccessor httpContextAccessor)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(httpContextAccessor);

        _dbContext = dbContext;
        _httpContextAccessor = httpContextAccessor;
    }

    /// <inheritdoc />
    public async Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default)
    {
        var httpContext = _httpContextAccessor.HttpContext;
        if (httpContext is null || !SessionTokenExtractor.TryGetBearerToken(httpContext.Request, out var rawToken))
        {
            return null;
        }

        var tokenHash = SessionTokens.Hash(rawToken);
        var now = DateTimeOffset.UtcNow;

        var session = await _dbContext.Sessions
            .AsNoTracking()
            .SingleOrDefaultAsync(candidate => candidate.TokenHash == tokenHash, cancellationToken);

        // Fail closed on anything that is not a live session carrying a bound persona.
        if (session is null || !session.IsLive(now) || session.PersonaId is not { } personaId || personaId == Guid.Empty)
        {
            return null;
        }

        return new CurrentSessionPersona
        {
            SessionId = session.Id,
            PersonaId = personaId,
            ExerciseId = session.ExerciseId,
            ActingHumanId = session.ActingHumanId,
        };
    }
}
