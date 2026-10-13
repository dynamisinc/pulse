namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

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
/// <para>
/// <b>Participant day cap on refresh (easy-login story 06, EL-10, EL-11).</b> A <c>participant</c>-kind session's
/// windows are recomputed on every refresh (see <see cref="ParticipantSessionCap"/>): the refresh window ends at the end
/// of the CURRENT exercise day and the access expiry is <c>min(now + SessionLifetime, end of day)</c>, so a session can
/// never slide into the next day. Once the day of the session's last issue or refresh has ended, refresh is the
/// ordinary fail-closed 401 with no event; a row whose stored window was still open at that point (stamped under the
/// old sliding rule) is also revoked, so it reads as ended in the audit trail and a retry stops at the revoked check. Refresh is deliberately NOT refused at EndEx (<c>completed</c>): the
/// lifecycle gate already refuses participant data routes, and refusing refresh would bounce participants off the
/// COR-054 EndEx overlay. Staff and read-only sessions renew exactly as before.
/// </para>
/// <para>
/// <b>A disabled participant cannot renew (easy-login Gate-2 W-001).</b> Disable ends the account's live sessions, but a
/// sign-in that raced it can mint one the sweep never saw. So a <c>participant</c>-kind session whose account staff have
/// disabled is refused on refresh, exactly like a revoked one: the same fail-closed 401, no event and no write. A
/// session that slipped through can therefore outlive the Disable by at most one access-token lifetime.
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
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly int _dayRolloverHour;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<SessionService> _logger;

    /// <summary>Creates the service over its persistence context, the configured session lifetimes and the day cap's inputs.</summary>
    /// <param name="dbContext">The persistence context the session mutation + its lifecycle event are written through.</param>
    /// <param name="options">The short-lived session / refresh-window lifetimes used when renewing on refresh, and the participant day-cap switch.</param>
    /// <param name="exerciseFacts">The easy-login exercise read (EL-17): the bound exercise's zone and stored scenario time on refresh.</param>
    /// <param name="easyLoginOptions">The easy-login settings, for the exercise day's rollover hour.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Logs the once-per-exercise time-zone fallback warning.</param>
    public SessionService(
        PulseDbContext dbContext,
        IOptions<SessionOptions> options,
        ExerciseFactsReader exerciseFacts,
        IOptions<EasyLoginOptions> easyLoginOptions,
        TimeProvider timeProvider,
        ILogger<SessionService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        ArgumentNullException.ThrowIfNull(easyLoginOptions);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _options = options.Value;
        _exerciseFacts = exerciseFacts;
        _dayRolloverHour = easyLoginOptions.Value.DayRolloverHour;
        _timeProvider = timeProvider;
        _logger = logger;
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

        var now = _timeProvider.GetUtcNow();
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
    /// (<see cref="RefreshOutcome.Invalid"/> → 401, no event) on an absent/unknown refresh token, or one whose session
    /// is revoked or whose refresh window has lapsed, or (a participant session) whose account is disabled, or (a capped
    /// participant session) whose exercise day has ended. In that last case the session is also revoked (still no
    /// event), because its stored window was still open.
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

        var now = _timeProvider.GetUtcNow();
        if (session is null ||
            session.RevokedAt is not null ||
            session.RefreshExpiresAt is null ||
            session.RefreshExpiresAt.Value <= now)
        {
            // Unknown / revoked / lapsed refresh window → force a full re-login (fail closed).
            return RefreshResult.Invalid();
        }

        if (session.Kind == ParticipantKind
            && session.AccountId is { } accountId
            && await IsAccountDisabledAsync(session.ExerciseId, accountId, cancellationToken))
        {
            // easy-login Gate-2 W-001: staff disabled this participant (a sign-in that raced the Disable can hold a
            // session its sweep never saw). Refused exactly as a revoked session is: 401, no event, nothing written.
            return RefreshResult.Invalid();
        }

        // The bound exercise's facts: the ONE exercise read on this path, through the easy-login reader (EL-17), shared
        // by the participant day cap (zone) and the session.refreshed envelope (stored scenario time + zone). The id is
        // the server-issued session's own binding, so a session for exercise A is only ever capped by A's zone.
        var facts = await _exerciseFacts.GetAsync(session.ExerciseId, cancellationToken);

        DateTimeOffset? endOfExerciseDay = null;
        if (ParticipantSessionCap.AppliesTo(session.Kind, _options))
        {
            // The session's day is the day of its last issue or refresh (IssuedAt). Recomputing that day's end from the
            // zone, rather than trusting the stored window alone, means a window stamped under other rules (option off,
            // or before the cap shipped) cannot carry the session into the next day either.
            endOfExerciseDay = ParticipantSessionCap.EndOfExerciseDay(
                session.ExerciseId,
                facts,
                session.IssuedAt,
                _dayRolloverHour,
                _logger);

            if (endOfExerciseDay.Value <= now)
            {
                // The exercise day is over → a full sign-in (tap the link again, or the new day's word). Same
                // fail-closed 401 as a lapsed window, and no event (story 06 telemetry AC). The stored window was still
                // open (the row predates the cap or was stamped with it off), so the row is ended here: RevokedAt marks
                // it as over in the audit trail, its access token stops at once, and a retry fails at the revoked check
                // above without another exercise read. Nothing else on the row changes.
                session.RevokedAt = now;
                await _dbContext.SaveChangesAsync(cancellationToken);
                return RefreshResult.Invalid();
            }
        }

        // Rotate both references (the old ones can no longer be replayed) and renew the windows. The binding is
        // PRESERVED verbatim — no field except the token hashes / timestamps is touched, so refresh can never
        // re-scope to a different exercise or account.
        var windows = ParticipantSessionCap.Windows(now, endOfExerciseDay, _options);
        var newSessionToken = SessionTokens.Generate();
        var newRefreshToken = SessionTokens.Generate();
        session.TokenHash = SessionTokens.Hash(newSessionToken);
        session.RefreshTokenHash = SessionTokens.Hash(newRefreshToken);
        session.IssuedAt = now;
        session.ExpiresAt = windows.ExpiresAt;
        session.RefreshExpiresAt = windows.RefreshExpiresAt;

        // The same session.refreshed event as before, built from the facts already read (no second exercise read).
        AddLifecycleEvent(session, SessionRefreshedEventType, now, facts?.StoredScenarioTime, facts?.TimeZone);
        await _dbContext.SaveChangesAsync(cancellationToken);

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

        var now = _timeProvider.GetUtcNow();
        session.RevokedAt = now;

        await EmitLifecycleEventAsync(session, LogoutEventType, now, cancellationToken);
    }

    /// <summary>
    /// Whether the participant account a session is bound to has been disabled by staff. The read ignores the central
    /// filter on purpose and carries BOTH ids explicitly instead: the refresh request's own resolved scope may be unset or
    /// another exercise, and a filtered read would then see no account and fail OPEN (renew). The ids are the
    /// server-issued session's own binding, never caller input, so the read cannot reach another exercise's account.
    /// </summary>
    private Task<bool> IsAccountDisabledAsync(Guid exerciseId, Guid accountId, CancellationToken cancellationToken) =>
        _dbContext.Accounts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(a => a.ExerciseId == exerciseId && a.Id == accountId && a.DisabledAt != null, cancellationToken);

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
        // org-scope-exempt(ResolvedScope): session.ExerciseId is the binding on a SERVER-ISSUED session row,
        // stamped at issue time from the resolved scope — the caller cannot name a different exercise here.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == session.ExerciseId, cancellationToken);

        AddLifecycleEvent(session, eventType, now, exercise?.CurrentScenarioTime, exercise?.TimeZone);

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Stages one XC-004 session-lifecycle event against the locked v0 envelope (the caller saves it with its session
    /// mutation). Scenario time is the bound exercise's stored scenario time, falling back to the wall clock; the zone
    /// falls back to UTC when the exercise could not be read.
    /// </summary>
    private void AddLifecycleEvent(
        Session session,
        string eventType,
        DateTimeOffset now,
        DateTimeOffset? storedScenarioTime,
        string? timeZone)
    {
        _dbContext.TelemetryEvents.Add(new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = session.ExerciseId,
            EventType = eventType,
            Channel = SystemChannel,
            Actor = BuildActor(session),
            WallClockTime = now,
            ScenarioTime = storedScenarioTime ?? now,
            TimeZone = timeZone ?? FallbackTimeZone,
            EmittedAt = now,
        });
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
        // The kind is DERIVED from whether a principal is actually attached, never hardcoded: the v0 envelope
        // conditionally requires participantId whenever kind is 'participant', so a participant session with no
        // PrincipalId (defensive — the issuer always sets one) degrades to the identity-less system actor rather
        // than emitting an off-envelope row (#356). Matches ParticipantLoginService's failure path.
        ParticipantKind => string.IsNullOrEmpty(session.PrincipalId)
            ? new TelemetryActor { Kind = SystemActorKind }
            : new TelemetryActor
            {
                Kind = ParticipantActorKind,
                ParticipantId = session.PrincipalId,
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
