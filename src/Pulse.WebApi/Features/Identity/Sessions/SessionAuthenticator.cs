namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;

/// <summary>
/// Default <see cref="ISessionAuthenticator"/> — hashes the presented token and looks the <c>Session</c> up by
/// <c>TokenHash</c>, returning it only when it is live (non-revoked, unexpired) and its person still permits it
/// (<see cref="SessionHolderQueries.HolderPermits"/>, #839). Registered as a singleton (it
/// is stateless and holds only the scope factory), exactly like <c>HostExerciseResolver</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a fresh DI scope per lookup (the always-Critical precedence-correctness point).</b>
/// <see cref="PulseDbContext"/> captures its exercise scope ONCE, at construction. The session middleware must
/// write <c>CurrentExerciseId</c> BEFORE the request-scoped <see cref="PulseDbContext"/> is constructed, so it
/// must NOT resolve that context to do the token lookup — doing so would build the context (locking its filter
/// to the still-provisional host scope) before the session's higher-precedence write lands. Opening a
/// short-lived <see cref="IServiceScope"/> here keeps the lookup fully isolated: the request-scoped context is
/// left untouched and is constructed lazily by the endpoint AFTER the middleware has set the scope. The
/// <c>Session</c> table is not <c>IExerciseScoped</c>, so the throwaway context's own (unset) scope does not
/// filter the lookup — that is exactly what lets the token that RESOLVES the scope be found pre-resolution.
/// </para>
/// <para>
/// <b>Fail closed on any lookup error.</b> A transient failure is caught and treated as "no live session"
/// (returns <c>null</c>) rather than 500-ing every authenticated request. No token or hash is ever logged.
/// </para>
/// </remarks>
public sealed partial class SessionAuthenticator : ISessionAuthenticator
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SessionAuthenticator> _logger;

    /// <summary>Creates the authenticator over the root scope factory it opens isolated lookup scopes from.</summary>
    /// <param name="scopeFactory">Factory for the short-lived DI scope each lookup runs in (see remarks).</param>
    /// <param name="logger">Diagnostics logger (a swallowed lookup failure is logged — never with token material).</param>
    public SessionAuthenticator(IServiceScopeFactory scopeFactory, ILogger<SessionAuthenticator> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<AuthenticatedSession?> AuthenticateAsync(string rawToken, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(rawToken))
        {
            return null;
        }

        var tokenHash = SessionTokens.Hash(rawToken);

        try
        {
            // Isolated lookup scope — never the request-scoped PulseDbContext (see the class remarks). Session
            // is unscoped, so this pre-resolution lookup is not filtered.
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

            var now = DateTimeOffset.UtcNow;

            // #839: the session's person is read in the SAME statement, so the person-state re-check costs no extra
            // round-trip on this every-request path.
            var row = await dbContext.Sessions
                .AsNoTracking()
                .Where(s => s.TokenHash == tokenHash)
                .WithHolderStanding(dbContext)
                .SingleOrDefaultAsync(cancellationToken);

            if (row is null || !row.Session.IsLive(now) || !SessionHolderQueries.HolderPermits(row.Session, row.Holder))
            {
                // Unknown / revoked / expired → no live session (fail closed). So is a session whose person has since been
                // disabled, lost the org-admin grant an org-scope session needs, or changed their password (#839): the
                // same anonymous outcome, so the request 401s exactly as a revoked session's does.
                return null;
            }

            var session = row.Session;

            return new AuthenticatedSession
            {
                SessionId = session.Id,
                ExerciseId = session.ExerciseId,
                Kind = session.Kind,
                StaffUserId = session.StaffUserId,

                // identity-auth-roles/13 (#362): the attribution facts POST /api/telemetry stamps instead of
                // believing. Read from the row this lookup already loaded — no extra query on a burst path.
                PrincipalId = session.PrincipalId,
                ActingHumanId = session.ActingHumanId,
                PersonaId = session.PersonaId,
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogAuthenticationFailed(ex);
            return null;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Session token authentication failed to complete its lookup; treating the request as unauthenticated (fail closed).")]
    private partial void LogAuthenticationFailed(Exception exception);
}
