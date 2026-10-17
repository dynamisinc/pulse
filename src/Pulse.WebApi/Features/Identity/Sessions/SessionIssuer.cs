namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Realtime;

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
/// <para>
/// <b>Participant day cap (easy-login story 06, EL-10).</b> A <c>participant</c>-kind session, whichever login method
/// issued it, gets a refresh window that ends at the end of the exercise day and an access expiry of
/// <c>min(now + SessionLifetime, end of day)</c> (see <see cref="ParticipantSessionCap"/>). The zone is read for the
/// request's own bound exercise through <see cref="ExerciseFactsReader"/>, and only when the cap applies; staff and
/// read-only sessions are stamped exactly as before.
/// </para>
/// <para>
/// <b>One world per browser origin — the server backstop (identity-auth-roles/16, ADMIN-IDENTITY-MODEL §1.2).</b> The
/// request's <c>Origin</c> header is stamped onto <see cref="Session.Origin"/>. Minting a session for person P in one
/// world (staff, or participant) revokes, in the SAME unit of work, P's live sessions of the OTHER world minted from
/// the same origin. Separate origins (the console host and the exercise hosts) legitimately hold one world each, and
/// a session with no person or no origin revokes nothing. Once that save commits, the revoked sessions' live hub
/// connections are cut too (<see cref="ISessionConnectionRevoker"/>, the same seam the grant-revoke rule uses), so a
/// revoked other-world tab stops receiving broadcasts at once rather than at its next re-validation.
/// </para>
/// </remarks>
public sealed partial class SessionIssuer : ISessionIssuer
{
    private readonly PulseDbContext _dbContext;
    private readonly SessionOptions _options;
    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly int _dayRolloverHour;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<SessionIssuer> _logger;
    private readonly IHttpContextAccessor? _httpContextAccessor;
    private readonly ISessionConnectionRevoker? _connectionRevoker;

    /// <summary>Creates the issuer over its persistence context, the configured session lifetimes and the day cap's inputs.</summary>
    /// <param name="dbContext">The persistence context the <see cref="Session"/> row is written through.</param>
    /// <param name="options">The short-lived session / refresh-window lifetimes (COR-012) and the participant day-cap switch.</param>
    /// <param name="exerciseFacts">The easy-login exercise read (EL-17), for the bound exercise's time zone.</param>
    /// <param name="easyLoginOptions">The easy-login settings, for the exercise day's rollover hour.</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="logger">Logs the once-per-exercise time-zone fallback warning.</param>
    /// <param name="httpContextAccessor">
    /// The current request, for its <c>Origin</c> header (the one-world-per-origin backstop). Optional: without it
    /// no origin is stamped and nothing is revoked across worlds.
    /// </param>
    /// <param name="connectionRevoker">
    /// Cuts the live hub connections of the other-world sessions the backstop revoked, after the commit. Optional: a host
    /// without the realtime hub has no connections to cut.
    /// </param>
    public SessionIssuer(
        PulseDbContext dbContext,
        IOptions<SessionOptions> options,
        ExerciseFactsReader exerciseFacts,
        IOptions<EasyLoginOptions> easyLoginOptions,
        TimeProvider timeProvider,
        ILogger<SessionIssuer> logger,
        IHttpContextAccessor? httpContextAccessor = null,
        ISessionConnectionRevoker? connectionRevoker = null)
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
        _httpContextAccessor = httpContextAccessor;
        _connectionRevoker = connectionRevoker;
    }

    /// <inheritdoc />
    public async Task<SessionIssueResult> IssueAsync(
        SessionIssueRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureValidScope(request);

        // Generate opaque references; only their hashes are persisted (the raw tokens are returned once).
        var sessionToken = SessionTokens.Generate();
        var refreshToken = SessionTokens.Generate();

        // One server wall-clock read shared by issued-at + both expiry windows (auth lifetime is REAL time,
        // never scenario time).
        var now = _timeProvider.GetUtcNow();
        var windows = ParticipantSessionCap.Windows(
            now,
            await EndOfExerciseDayAsync(request, now, cancellationToken),
            _options);

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
            PersonId = request.PersonId,
            Origin = ReadOrigin(),
            IssuedAt = now,
            ExpiresAt = windows.ExpiresAt,
            RefreshExpiresAt = windows.RefreshExpiresAt,
        };

        _dbContext.Sessions.Add(session);
        var revoked = await RevokeOtherWorldSessionsAsync(session, now, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await CutRevokedConnectionsAsync(revoked, cancellationToken);

        return new SessionIssueResult
        {
            Session = session,
            SessionToken = sessionToken,
            RefreshToken = refreshToken,
        };
    }

    /// <summary>
    /// The end of the exercise day for a capped (participant, option on) request, or <c>null</c> when the session is not
    /// capped. The zone is read for the request's OWN bound exercise only: <see cref="SessionIssueRequest.ExerciseId"/>
    /// is the server-resolved scope every login method has already checked, never a client-named exercise.
    /// </summary>
    private async Task<DateTimeOffset?> EndOfExerciseDayAsync(
        SessionIssueRequest request,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!ParticipantSessionCap.AppliesTo(request.Kind, _options))
        {
            return null;
        }

        // A participant session always carries its host-resolved exercise; an org-scope request is never a
        // participant one, so there is no day to cap without an exercise.
        if (request.ExerciseId is not { } exerciseId)
        {
            return null;
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);

        return ParticipantSessionCap.EndOfExerciseDay(
            exerciseId,
            facts,
            now,
            _dayRolloverHour,
            _logger);
    }

    /// <summary>
    /// The session-scope invariants (M-6), checked before anything is generated or persisted: an org-scope session (no
    /// exercise) is ONLY a <c>staff</c> session with role <c>orgAdmin</c>, and role <c>orgAdmin</c> is ONLY ever issued
    /// org-scoped (it is <see cref="Person.OrgRole"/>, no longer an exercise role). The database backs the first half
    /// with <c>CK_Sessions_ExerciseId_OrgAdminOnly</c>; the second is enforced here only, because legacy revoked
    /// <c>orgAdmin</c> rows still carry an exercise. A violation is a caller bug, never a user error.
    /// </summary>
    /// <param name="request">The issue request.</param>
    /// <exception cref="InvalidOperationException">The request breaks either invariant.</exception>
    private static void EnsureValidScope(SessionIssueRequest request)
    {
        var isOrgAdmin = string.Equals(request.Role, Person.OrgAdminRole, StringComparison.OrdinalIgnoreCase);

        if (request.ExerciseId is null
            && !(isOrgAdmin && string.Equals(request.Kind, StaffKind, StringComparison.Ordinal)))
        {
            throw new InvalidOperationException(
                "A session without an exercise (org scope) may only be issued as a staff session with role orgAdmin.");
        }

        if (isOrgAdmin && request.ExerciseId is not null)
        {
            throw new InvalidOperationException(
                "A session with role orgAdmin may only be issued org-scoped (no exercise); orgAdmin is not an exercise role.");
        }
    }

    /// <summary>The world a session kind belongs to: <c>staff</c> for staff sessions, <c>participant</c> otherwise.</summary>
    /// <param name="kind">A <see cref="Session.Kind"/> value.</param>
    /// <returns><c>staff</c> or <c>participant</c>.</returns>
    public static string WorldOf(string kind) =>
        string.Equals(kind, StaffKind, StringComparison.Ordinal) ? StaffWorld : ParticipantWorld;

    /// <summary>The staff world.</summary>
    public const string StaffWorld = "staff";

    /// <summary>The participant world (participant and read-only sessions).</summary>
    public const string ParticipantWorld = "participant";

    private const string StaffKind = "staff";

    /// <summary>
    /// Reads the request's <c>Origin</c> header, bounded to <see cref="Session.MaxOriginLength"/>; <c>null</c> when
    /// absent, blank, oversized, or when there is no request.
    /// </summary>
    private string? ReadOrigin()
    {
        var origin = _httpContextAccessor?.HttpContext?.Request.Headers.Origin.ToString().Trim();
        return string.IsNullOrEmpty(origin) || origin.Length > Session.MaxOriginLength ? null : origin;
    }

    /// <summary>
    /// Stages the revocation of the person's live OTHER-world sessions minted from the same origin (the server
    /// backstop of the one-world-per-origin rule) and returns their ids, so their live hub connections can be cut once
    /// the revocation commits. A no-op (empty) without a person or an origin.
    /// </summary>
    private async Task<IReadOnlyList<Guid>> RevokeOtherWorldSessionsAsync(Session minted, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (minted.PersonId is not { } personId || minted.Origin is not { } origin)
        {
            return [];
        }

        var mintedIsStaff = string.Equals(minted.Kind, StaffKind, StringComparison.Ordinal);

        // Session is unscoped (looked up pre-scope); the person + origin predicate confines this to the one human.
        var others = await _dbContext.Sessions
            .Where(s => s.PersonId == personId
                && s.Origin == origin
                && s.RevokedAt == null
                && s.Id != minted.Id
                && (mintedIsStaff ? s.Kind != StaffKind : s.Kind == StaffKind))
            .ToListAsync(cancellationToken);

        var revoked = new List<Guid>();
        foreach (var other in others.Where(other => other.IsLive(now)))
        {
            other.RevokedAt = now;
            revoked.Add(other.Id);
        }

        return revoked;
    }

    /// <summary>
    /// Cuts the live hub connections of the just-committed backstop revocations. The new session has already committed,
    /// so a failure here is logged, never surfaced: the revoked rows are dead regardless, and a connection that survives
    /// fails its next re-validation.
    /// </summary>
    private async Task CutRevokedConnectionsAsync(IReadOnlyList<Guid> revoked, CancellationToken cancellationToken)
    {
        if (_connectionRevoker is null || revoked.Count == 0)
        {
            return;
        }

        try
        {
            await _connectionRevoker.RevokeAsync(revoked, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogConnectionCutFailed(revoked.Count, exception);
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Could not cut the live hub connections of {Count} other-world session(s) revoked by the one-world-per-origin backstop.")]
    private partial void LogConnectionCutFailed(int count, Exception exception);
}
