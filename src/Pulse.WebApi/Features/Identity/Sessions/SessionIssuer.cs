namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The single <see cref="ISessionIssuer"/> implementation (story 03, the hinge): every login method
/// (participant story 02, staff story 05, shared read-only story 06) mints a session through here after it has
/// ALREADY authenticated the principal and resolved the bound exercise. It generates a cryptographically-random
/// opaque session token AND a refresh token, persists ONLY their hashes (never the raw tokens — NFR-009), stamps
/// a short-lived expiry + a refresh window server-side, binds the resolved identity/exercise/role onto a
/// <see cref="Session"/> row, and returns the raw tokens to the caller exactly once. Scoped lifetime, matching
/// the <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>No telemetry is emitted here (deliberate, documented).</b> The XC-004 <c>login</c> event is the
/// LOGIN METHOD's concern — the caller (e.g. <c>StaffLoginService</c>) emits exactly one <c>login</c>
/// success/failure event in its own unit of work and then calls this issuer. If the issuer ALSO emitted a
/// <c>login</c> event, a single login would double-count. Story 03 owns the session-LIFECYCLE events
/// (<c>session.refreshed</c> / <c>session.expired</c> / <c>logout</c>, all in <see cref="SessionService"/>),
/// not the login-attempt event — see the story-03 telemetry AC.
/// </para>
/// <para>
/// <b>Server-authoritative.</b> Issued-at / expiry / the tokens are all stamped by the server (one wall-clock
/// read shared across the row); nothing is taken from client input. The refresh token is always issued so a
/// short-lived session can be renewed by <see cref="SessionService.RefreshAsync"/> before it lapses.
/// </para>
/// </remarks>
public sealed class SessionIssuer : ISessionIssuer
{
    private readonly PulseDbContext _dbContext;
    private readonly SessionOptions _options;

    /// <summary>Creates the issuer over its persistence context and the configured session lifetimes.</summary>
    /// <param name="dbContext">The persistence context the <see cref="Session"/> row is written through.</param>
    /// <param name="options">The short-lived session / refresh-window lifetimes (COR-012).</param>
    public SessionIssuer(PulseDbContext dbContext, IOptions<SessionOptions> options)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(options);

        _dbContext = dbContext;
        _options = options.Value;
    }

    /// <inheritdoc />
    public async Task<SessionIssueResult> IssueAsync(
        SessionIssueRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Generate opaque references; only their hashes are persisted (the raw tokens are returned once).
        var sessionToken = SessionTokens.Generate();
        var refreshToken = SessionTokens.Generate();

        // One server wall-clock read shared by issued-at + both expiry windows (auth lifetime is REAL time,
        // never scenario time).
        var now = DateTimeOffset.UtcNow;

        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(sessionToken),
            RefreshTokenHash = SessionTokens.Hash(refreshToken),
            Kind = request.Kind,
            ExerciseId = request.ExerciseId,
            PrincipalId = request.PrincipalId,
            AccountId = request.AccountId,
            StaffUserId = request.StaffUserId,
            Role = request.Role,
            PersonaId = request.PersonaId,
            ActingHumanId = request.ActingHumanId,
            IsReadOnly = request.IsReadOnly,
            IssuedAt = now,
            ExpiresAt = now + _options.SessionLifetime,
            RefreshExpiresAt = now + _options.RefreshLifetime,
        };

        _dbContext.Sessions.Add(session);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new SessionIssueResult
        {
            Session = session,
            SessionToken = sessionToken,
            RefreshToken = refreshToken,
        };
    }
}
