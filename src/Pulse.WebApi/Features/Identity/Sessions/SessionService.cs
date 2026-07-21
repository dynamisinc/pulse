namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The service behind the three session-lifecycle endpoints (story 03): <c>GET /api/session</c> (resolve the
/// current bound session), <c>POST /api/auth/refresh</c> (renew a short-lived session, preserving its binding),
/// and <c>POST /api/auth/logout</c> (server-side invalidation). It owns the session-LIFECYCLE XC-004 events —
/// <c>session.refreshed</c>, <c>session.expired</c>, <c>logout</c> — each emitted in the SAME unit of work as
/// the mutation it accompanies. Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail closed &amp; server-authoritative.</b> A missing, unknown, revoked, or expired token resolves NO
/// session (<c>GET /api/session</c> → 401 rather than a default/stale session; refresh → 401). Expiry is a REAL
/// wall-clock concern (never scenario time). Refresh ROTATES both the session token and the refresh token — the
/// old refresh token's hash is overwritten, so a stolen refresh reference cannot be replayed — and never
/// re-scopes: every binding field (exercise, principal, account, staff user, role, persona, acting human,
/// read-only) is preserved verbatim. Logout sets <c>RevokedAt</c> so a stolen session reference cannot be
/// replayed; it is idempotent.
/// </para>
/// <para>
/// <b>Scenario time = the exercise's stored scenario time (documented B2 placeholder).</b> Lifecycle events
/// stamp <c>scenarioTime</c> from the bound <see cref="Exercise.CurrentScenarioTime"/> (falling back to the
/// wall clock when unset) until the native backend scenario clock (COR-050) lands in Phase B3 — mirroring
/// <c>StaffLoginService</c>. The <c>session.expired</c> event is emitted only from <c>GET /api/session</c> (the
/// bounded moment the client learns it must re-auth), never per-request in the middleware, to avoid spamming.
/// </para>
/// </remarks>
public sealed class SessionService
{
    private const string SchemaVersion = "v0";
    private const string SystemChannel = "system";
    private const string ParticipantKind = "participant";
    private const string ReadOnlyKind = "readonly";
    private const string ParticipantActorKind = "participant";
    private const string SystemActorKind = "system";
    private const string SessionRefreshedEventType = "session.refreshed";
    private const string SessionExpiredEventType = "session.expired";
    private const string LogoutEventType = "logout";
    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly SessionOptions _options;

    /// <summary>Creates the service over its persistence context and the configured session lifetimes.</summary>
    /// <param name="dbContext">The persistence context the session mutation + its lifecycle event are written through.</param>
    /// <param name="options">The short-lived session / refresh-window lifetimes used when renewing on refresh.</param>
    public SessionService(PulseDbContext dbContext, IOptions<SessionOptions> options)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(options);

        _dbContext = dbContext;
        _options = options.Value;
    }

    /// <summary>
    /// Resolves the current request's bound session for <c>GET /api/session</c>. Returns
    /// <see cref="SessionQueryOutcome.Live"/> with the session when live; otherwise fails closed
    /// (<see cref="SessionQueryOutcome.Absent"/> for absent/unknown/revoked, or
    /// <see cref="SessionQueryOutcome.Expired"/> for an expired session, which also emits one
    /// <c>session.expired</c> XC-004 event). Every non-live outcome maps to 401 at the endpoint.
    /// </summary>
    /// <param name="rawToken">The presented raw token, or <c>null</c> when none.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resolution result.</returns>
    public async Task<SessionQueryResult> GetCurrentAsync(string? rawToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(rawToken))
        {
            return SessionQueryResult.Absent();
        }

        var tokenHash = SessionTokens.Hash(rawToken);
        var session = await _dbContext.Sessions
            .SingleOrDefaultAsync(s => s.TokenHash == tokenHash, cancellationToken);

        if (session is null)
        {
            return SessionQueryResult.Absent();
        }

        var now = DateTimeOffset.UtcNow;
        if (session.IsLive(now))
        {
            return SessionQueryResult.Live(session);
        }

        // Not live. Distinguish the two fail-closed cases for telemetry: an EXPIRED (not revoked) session is
        // the re-auth-forcing event we record ONCE here (the moment the client learns it must re-auth), 401;
        // an already-invalidated (logged out / revoked) session is a silent 401 (no session.expired).
        if (session.RevokedAt is null)
        {
            await EmitLifecycleEventAsync(session, SessionExpiredEventType, now, cancellationToken);
            return SessionQueryResult.Expired();
        }

        return SessionQueryResult.Absent();
    }

    /// <summary>
    /// Renews a short-lived session for <c>POST /api/auth/refresh</c> from its refresh token, rotating BOTH
    /// tokens and preserving the exact binding (never re-scoping to a different exercise / account). Emits one
    /// <c>session.refreshed</c> XC-004 event in the same unit of work. Fails closed
    /// (<see cref="RefreshOutcome.Invalid"/> → 401) on an absent/unknown refresh token, or one whose session is
    /// revoked or whose refresh window has lapsed.
    /// </summary>
    /// <param name="rawRefreshToken">The presented raw refresh token, or <c>null</c> when none.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The refresh result — the rotated tokens + renewed session on success.</returns>
    public async Task<RefreshResult> RefreshAsync(string? rawRefreshToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(rawRefreshToken))
        {
            return RefreshResult.Invalid();
        }

        var refreshHash = SessionTokens.Hash(rawRefreshToken);
        var session = await _dbContext.Sessions
            .SingleOrDefaultAsync(s => s.RefreshTokenHash == refreshHash, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        if (session is null ||
            session.RevokedAt is not null ||
            session.RefreshExpiresAt is null ||
            session.RefreshExpiresAt.Value <= now)
        {
            // Unknown / revoked / lapsed refresh window → force a full re-login (fail closed).
            return RefreshResult.Invalid();
        }

        // Rotate both references (the old ones can no longer be replayed) and renew the windows. The binding is
        // PRESERVED verbatim — no field except the token hashes / timestamps is touched, so refresh can never
        // re-scope to a different exercise or account.
        var newSessionToken = SessionTokens.Generate();
        var newRefreshToken = SessionTokens.Generate();
        session.TokenHash = SessionTokens.Hash(newSessionToken);
        session.RefreshTokenHash = SessionTokens.Hash(newRefreshToken);
        session.IssuedAt = now;
        session.ExpiresAt = now + _options.SessionLifetime;
        session.RefreshExpiresAt = now + _options.RefreshLifetime;

        await EmitLifecycleEventAsync(session, SessionRefreshedEventType, now, cancellationToken);

        return RefreshResult.Refreshed(session, newSessionToken, newRefreshToken);
    }

    /// <summary>
    /// Invalidates the current request's session server-side for <c>POST /api/auth/logout</c> by setting
    /// <c>RevokedAt</c>, so a stolen reference cannot be replayed, and emits one <c>logout</c> XC-004 event in
    /// the same unit of work. Idempotent: an absent/unknown/already-revoked token is a no-op (no event) — the
    /// endpoint always returns 204 and never reveals whether the token was valid.
    /// </summary>
    /// <param name="rawToken">The presented raw token, or <c>null</c> when none.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    public async Task LogoutAsync(string? rawToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(rawToken))
        {
            return;
        }

        var tokenHash = SessionTokens.Hash(rawToken);
        var session = await _dbContext.Sessions
            .SingleOrDefaultAsync(s => s.TokenHash == tokenHash, cancellationToken);

        if (session is null || session.RevokedAt is not null)
        {
            // Nothing live to invalidate — idempotent no-op.
            return;
        }

        var now = DateTimeOffset.UtcNow;
        session.RevokedAt = now;

        await EmitLifecycleEventAsync(session, LogoutEventType, now, cancellationToken);
    }

    /// <summary>
    /// Adds one XC-004 session-lifecycle event against the locked v0 envelope and persists it together with the
    /// accompanying session mutation in ONE <c>SaveChangesAsync</c> (the same unit of work). Scenario time is
    /// the bound exercise's stored scenario time (B2 placeholder, falling back to the wall clock).
    /// </summary>
    private async Task EmitLifecycleEventAsync(
        Session session,
        string eventType,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // The bound exercise supplies the (placeholder) scenario time + time zone for the envelope. It is the
        // unscoped scope root, so this read is not filtered.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == session.ExerciseId, cancellationToken);

        var scenarioTime = exercise?.CurrentScenarioTime ?? now;
        var timeZone = exercise?.TimeZone ?? FallbackTimeZone;

        _dbContext.TelemetryEvents.Add(new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = session.ExerciseId,
            EventType = eventType,
            Channel = SystemChannel,
            Actor = BuildActor(session),
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = timeZone,
            EmittedAt = now,
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Builds the v0 actor block for a session-lifecycle event, shaped per session kind (story-03 telemetry AC):
    /// participant → <c>kind: 'participant'</c> + <c>participantId</c> (the account id); read-only →
    /// <c>kind: 'system'</c> + <c>sessionId</c> (the ephemeral identity, COR-015 — no named account); staff (and
    /// any other) → <c>kind: 'system'</c> + <c>role</c> + <c>actingHumanId</c>. Off-envelope empty strings are
    /// null-omitted (the v0 schema types the optional actor ids as <c>min(1).optional()</c>).
    /// </summary>
    private static TelemetryActor BuildActor(Session session) => session.Kind switch
    {
        ParticipantKind => new TelemetryActor
        {
            Kind = ParticipantActorKind,
            ParticipantId = string.IsNullOrEmpty(session.PrincipalId) ? null : session.PrincipalId,
        },
        ReadOnlyKind => new TelemetryActor
        {
            Kind = SystemActorKind,
            SessionId = string.IsNullOrEmpty(session.PrincipalId) ? null : session.PrincipalId,
        },
        _ => new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = string.IsNullOrEmpty(session.Role) ? null : session.Role,
            ActingHumanId = string.IsNullOrEmpty(session.ActingHumanId) ? null : session.ActingHumanId,
        },
    };
}

/// <summary>The outcome kind of a <see cref="SessionService.GetCurrentAsync"/> call.</summary>
public enum SessionQueryOutcome
{
    /// <summary>A live bound session was resolved — the endpoint returns the frozen <c>SessionDto</c>.</summary>
    Live,

    /// <summary>The session exists but is expired — the endpoint returns 401 (a <c>session.expired</c> event was emitted).</summary>
    Expired,

    /// <summary>No live session (absent / unknown / revoked token) — the endpoint returns 401.</summary>
    Absent,
}

/// <summary>
/// The result of <see cref="SessionService.GetCurrentAsync"/>. <see cref="SessionQueryOutcome.Live"/> carries
/// the resolved <see cref="Session"/>; the fail-closed outcomes carry none.
/// </summary>
public sealed class SessionQueryResult
{
    private SessionQueryResult(SessionQueryOutcome outcome, Session? session)
    {
        Outcome = outcome;
        Session = session;
    }

    /// <summary>Which outcome occurred.</summary>
    public SessionQueryOutcome Outcome { get; }

    /// <summary>The resolved session — non-null only when <see cref="Outcome"/> is <see cref="SessionQueryOutcome.Live"/>.</summary>
    public Session? Session { get; }

    /// <summary>A live bound session.</summary>
    /// <param name="session">The resolved session.</param>
    /// <returns>A live result.</returns>
    public static SessionQueryResult Live(Session session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return new SessionQueryResult(SessionQueryOutcome.Live, session);
    }

    /// <summary>An expired session (a <c>session.expired</c> event was emitted).</summary>
    /// <returns>An expired result.</returns>
    public static SessionQueryResult Expired() => new(SessionQueryOutcome.Expired, null);

    /// <summary>No live session.</summary>
    /// <returns>An absent result.</returns>
    public static SessionQueryResult Absent() => new(SessionQueryOutcome.Absent, null);
}

/// <summary>The outcome kind of a <see cref="SessionService.RefreshAsync"/> call.</summary>
public enum RefreshOutcome
{
    /// <summary>The session was renewed and its tokens rotated.</summary>
    Refreshed,

    /// <summary>The refresh token was absent / unknown / revoked / lapsed — the endpoint returns 401 (re-auth).</summary>
    Invalid,
}

/// <summary>
/// The result of <see cref="SessionService.RefreshAsync"/>. <see cref="RefreshOutcome.Refreshed"/> carries the
/// renewed session and the freshly rotated raw tokens (handed to the client once); <see cref="RefreshOutcome.Invalid"/>
/// carries none.
/// </summary>
public sealed class RefreshResult
{
    private RefreshResult(RefreshOutcome outcome, Session? session, string? sessionToken, string? refreshToken)
    {
        Outcome = outcome;
        Session = session;
        SessionToken = sessionToken;
        RefreshToken = refreshToken;
    }

    /// <summary>Which outcome occurred.</summary>
    public RefreshOutcome Outcome { get; }

    /// <summary>The renewed session — non-null only when <see cref="Outcome"/> is <see cref="RefreshOutcome.Refreshed"/>.</summary>
    public Session? Session { get; }

    /// <summary>The rotated raw session token — non-null only on success.</summary>
    public string? SessionToken { get; }

    /// <summary>The rotated raw refresh token — non-null only on success.</summary>
    public string? RefreshToken { get; }

    /// <summary>A successful refresh.</summary>
    /// <param name="session">The renewed session.</param>
    /// <param name="sessionToken">The rotated raw session token.</param>
    /// <param name="refreshToken">The rotated raw refresh token.</param>
    /// <returns>A refreshed result.</returns>
    public static RefreshResult Refreshed(Session session, string sessionToken, string refreshToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentException.ThrowIfNullOrEmpty(sessionToken);
        ArgumentException.ThrowIfNullOrEmpty(refreshToken);
        return new RefreshResult(RefreshOutcome.Refreshed, session, sessionToken, refreshToken);
    }

    /// <summary>The fail-closed result for an unusable refresh token.</summary>
    /// <returns>An invalid result.</returns>
    public static RefreshResult Invalid() => new(RefreshOutcome.Invalid, null, null, null);
}

/// <summary>
/// The <c>POST /api/auth/refresh</c> request body (camelCase JSON). The <see cref="RefreshToken"/> is nullable
/// so a missing field is a validation concern (a 401 re-auth), never a deserialization failure; it is never
/// logged (NFR-009).
/// </summary>
public sealed class RefreshRequest
{
    /// <summary>The raw refresh token issued at login / a prior refresh.</summary>
    public string? RefreshToken { get; init; }
}

/// <summary>
/// The <c>POST /api/auth/refresh</c> success response: the freshly ROTATED raw tokens (handed to the client
/// exactly once; only their hashes are persisted — NFR-009) plus the frozen <see cref="SessionDto"/> projection
/// of the renewed session (XC-002: no provenance).
/// </summary>
public sealed class SessionRefreshResponseDto
{
    /// <summary>The rotated raw session token to present on subsequent requests (only its hash is persisted).</summary>
    [JsonPropertyName("token")]
    public required string Token { get; init; }

    /// <summary>The rotated raw refresh token to present at the next refresh (only its hash is persisted).</summary>
    [JsonPropertyName("refreshToken")]
    public required string RefreshToken { get; init; }

    /// <summary>The renewed session, projected to the frozen participant-safe wire shape.</summary>
    [JsonPropertyName("session")]
    public required SessionDto Session { get; init; }

    /// <summary>Builds the refresh response from a successful <see cref="RefreshResult"/>.</summary>
    /// <param name="result">The refresh result (must be <see cref="RefreshOutcome.Refreshed"/>).</param>
    /// <returns>The refresh response DTO.</returns>
    public static SessionRefreshResponseDto From(RefreshResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new SessionRefreshResponseDto
        {
            Token = result.SessionToken!,
            RefreshToken = result.RefreshToken!,
            Session = SessionDto.FromSession(result.Session!),
        };
    }
}
