namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The exercise-scoped SignalR hub that fans a newly-persisted post out to every currently-connected
/// participant session in the SAME exercise run (SOC-083) — closing the cross-session gap the in-memory
/// pub/sub could never span — and carries the staff-only pushes (the review cockpit's
/// <c>ReviewItemChanged</c>) to that exercise's verified staff connections only. Every connection joins the
/// exercise-wide group keyed by the exercise the connection's own host resolves to (COR-001); a verified staff
/// connection ALSO joins that exercise's staff group (demo-polish B5). Neither group is ever named by a
/// client-supplied value.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail-closed group membership (the always-Critical isolation property, Tier-2).</b> The group a
/// connection joins is derived ONLY from the host-resolved exercise the
/// <see cref="ExerciseResolutionMiddleware"/> stamped on the connection's own <c>HttpContext.Items</c> — read
/// here via <c>Context.GetHttpContext()?.GetHostResolvedExerciseId()</c> — through <see cref="GroupNameFor"/>.
/// This hub deliberately exposes NO client-invocable method that accepts a group name or exercise id, so a
/// client cannot join, or receive a broadcast for, any exercise but its own. When no host resolved (the id is
/// <c>null</c> or <see cref="Guid.Empty"/>) the connection is aborted rather than joined to any group — an
/// absent scope is a closed door, never a default or an unscoped join.
/// </para>
/// <para>
/// <b>Role-scoped staff group (demo-polish B5, home story social-api/05, XC-002).</b> Participant and staff
/// connections share this hub, so a staff-only event sent to the exercise-wide group would land in every
/// participant's browser (unpublished engine drafts in devtools — a two-worlds leak). A connection therefore
/// joins <see cref="StaffGroupNameFor"/> as well ONLY when the server has verified, at connect time, that it
/// belongs to a live <c>staff</c>-kind session assigned to the SAME host-resolved exercise the exercise-wide
/// join used. "Staff" is decided from the connection's AUTHENTICATED SESSION alone — the principal
/// <see cref="SessionAuthenticationMiddleware"/> resolved server-side from the presented token and assigned to
/// the connection request's <c>HttpContext.User</c> — and is then re-verified against the persisted
/// <c>Session</c> row and the caller's <c>StaffAssignment</c> set. No query value, header or client message is
/// ever consulted. Participant, shared read-only, anonymous, expired, revoked, unassigned or cross-tenant
/// connections never join the staff group; staff-only broadcasters target it (see
/// <c>EngineReviewBroadcaster</c>) while participant-safe broadcasters keep targeting
/// <see cref="GroupNameFor"/>.
/// </para>
/// <para>
/// <b>Why the staff check does not use the registered <see cref="ICurrentStaffSessionAccessor"/>.</b> That
/// accessor reads the token from the <c>Authorization</c> header only (see the trap documented on
/// <see cref="SessionTokenExtractor"/>), and a browser WebSocket presents its token only as
/// <c>?access_token=</c> — so it would report "no staff session" for every real console connection. The hub
/// instead keys the same checks (live, non-revoked, unexpired, <c>staff</c>-kind, bound to a
/// <c>StaffUser</c>) off the session id the connection's server-resolved principal carries, and reuses
/// <see cref="StaffAssignmentService.GetAssignmentsAsync"/> — the own-only, tenant-bounded assignment read the
/// review cockpit's <c>EngineCockpitStaffAuthorizationFilter</c> gates on — rather than inventing a second
/// notion of "is staff".
/// </para>
/// <para>
/// <b>A live session is required to reach this hub at all (identity-auth-roles/11).</b> Host-derived group
/// membership answers "WHICH exercise" (COR-001) and was always correct; it never answered "MAY this caller
/// connect". It could not — an unauthenticated client provably negotiated, handshook, joined the group and
/// received a live <c>PostReceived</c> frame (#359, exploit 3). Both hub endpoints (the connection and its
/// <c>/negotiate</c> sibling) now inherit the default-deny fallback policy, so
/// <see cref="OnConnectedAsync"/> is not reached without a live session — the abort below stays as
/// defense-in-depth for the resolved-session-but-unresolved-host case. Because a browser cannot set an
/// <c>Authorization</c> header on a WebSocket upgrade, the SignalR client supplies its token as
/// <c>?access_token=</c>, which <c>SessionTokenExtractor</c> accepts under <c>/hubs</c> only.
/// </para>
/// <para>
/// <b>Why the host-resolved <c>HttpContext</c>, not the injected <see cref="IExerciseContext"/>.</b> SignalR
/// dispatches <see cref="OnConnectedAsync"/> in its OWN per-invocation DI scope — NOT the connection's
/// HTTP-request scope where <c>UseExerciseResolution</c> populated the scoped
/// <see cref="IExerciseContext"/>. A hub that read the injected <see cref="IExerciseContext"/> would therefore
/// always see a fresh, unset one (<see cref="Guid.Empty"/>) and abort EVERY connection — the confirmed cause
/// of the "handshake then immediate server close, no live pushes" bug. <c>Context.GetHttpContext()</c> instead
/// returns the original connection request's <c>HttpContext</c> — the very request the middleware ran on — so
/// the same server-side, host-derived exercise id the HTTP endpoints resolve is available here. This keeps the
/// scope server-authoritative (COR-001); do not reintroduce the injected-context read. The injected
/// <see cref="PulseDbContext"/> lives in that same hub scope (its exercise filter is therefore unset); the
/// staff check reads only unscoped access records (<c>Session</c>, <c>StaffUser</c>, <c>StaffAssignment</c>,
/// <c>Exercise</c>), never <see cref="IExerciseScoped"/> content, and runs only for a staff-kind principal —
/// a participant connection performs no database work here.
/// </para>
/// <para>
/// <b>A staff check that cannot complete ABORTS the connection — it is never rethrown (Gate-2 L-1).</b> The
/// check reads the database, which can fail transiently (e.g. a serverless SQL database resuming from
/// auto-pause). An exception escaping <see cref="OnConnectedAsync"/> makes SignalR close the connection with
/// <c>allowReconnect: false</c>, which the JS client does NOT retry — the controller console would silently lose
/// its live review pushes until a page refresh. The failure is therefore logged and the connection aborted
/// instead: still fail-closed (the staff join is never reached), but dropped the way the client's automatic
/// reconnect treats as transient, so the next attempt re-runs the check. Cancellation caused by the
/// connection's OWN abort is not a check failure and is left to propagate.
/// </para>
/// </remarks>
public sealed partial class ExerciseRealtimeHub : Hub
{
    /// <summary>The session kind that may be considered for the staff group.</summary>
    private const string StaffSessionKind = "staff";

    private readonly PulseDbContext _dbContext;
    private readonly ILogger<ExerciseRealtimeHub> _logger;

    /// <summary>Creates the hub over the persistence context its staff-membership check reads through.</summary>
    /// <param name="dbContext">
    /// The hub-scope persistence context. Used ONLY to verify a staff-kind connection's session and assignment
    /// (unscoped access records); never touched for a participant, read-only or anonymous connection.
    /// </param>
    /// <param name="logger">Diagnostics logger (a failed staff check is logged; never token material).</param>
    public ExerciseRealtimeHub(PulseDbContext dbContext, ILogger<ExerciseRealtimeHub> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _logger = logger;
    }

    /// <summary>
    /// The SignalR group name for an exercise run — the single source of truth shared with
    /// <see cref="SignalRFeedBroadcaster"/> so the join side and the broadcast side can never drift apart.
    /// Always server-derived from the host-resolved exercise id; never built from client input.
    /// </summary>
    /// <param name="exerciseId">The owning exercise run.</param>
    /// <returns>The group name, <c>exercise:{exerciseId}</c>.</returns>
    internal static string GroupNameFor(Guid exerciseId) => $"exercise:{exerciseId}";

    /// <summary>
    /// The SignalR group name for an exercise run's VERIFIED STAFF connections — the single source of truth
    /// shared with the staff-only broadcasters (<c>EngineReviewBroadcaster</c>) so the join side and the
    /// broadcast side can never drift apart. Derived from the same server-resolved exercise id as
    /// <see cref="GroupNameFor"/>; never built from client input. Disjoint from every
    /// <see cref="GroupNameFor"/> value (no exercise-wide group name carries the <c>:staff</c> suffix).
    /// </summary>
    /// <param name="exerciseId">The owning exercise run.</param>
    /// <returns>The group name, <c>exercise:{exerciseId}:staff</c>.</returns>
    internal static string StaffGroupNameFor(Guid exerciseId) => $"{GroupNameFor(exerciseId)}:staff";

    /// <summary>
    /// Resolves this connection's exercise scope from the connection's host-resolved <c>HttpContext</c> and
    /// joins the corresponding group — plus that exercise's staff group when, and only when, the connection's
    /// authenticated session is a live staff session assigned to that exercise. A <c>null</c> or empty scope
    /// aborts the connection (fail closed) rather than joining any group.
    /// </summary>
    /// <returns>A task that completes when the connection's group membership is established.</returns>
    public override async Task OnConnectedAsync()
    {
        // SignalR runs OnConnectedAsync in its OWN DI scope, so the scoped IExerciseContext the
        // UseExerciseResolution middleware populated on the connection REQUEST never reaches this hub
        // instance (it would read a fresh, null one and abort every connection). Read the host-resolved
        // exercise off the connection's HttpContext, where the middleware also stashed it.
        var httpContext = Context.GetHttpContext();
        var exerciseId = httpContext?.GetHostResolvedExerciseId();
        if (httpContext is null || exerciseId is null || exerciseId.Value == Guid.Empty)
        {
            Context.Abort(); // fail closed: never join an ambient/empty exercise group
            return;
        }

        // The exercise-wide join comes FIRST, so a staff connection receives participant-safe pushes
        // (PostReceived) as promptly as a participant connection does — the staff check below costs a few
        // queries and must not delay it.
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupNameFor(exerciseId.Value));

        // Only a connection the check positively verifies ever reaches the staff join. A check that cannot
        // complete (e.g. a transient database error) is logged and the connection ABORTED — never rethrown, and
        // never treated as verified. Rethrowing would make SignalR close with allowReconnect:false, which the JS
        // client does not retry; an abort is a drop it reconnects from, re-running this check. Aborting also
        // removes the connection from the exercise-wide group joined above. Cancellation caused by the
        // connection's own abort is not a check failure and propagates untouched.
        var connectionAborted = Context.ConnectionAborted;
        bool isVerifiedStaff;
        try
        {
            isVerifiedStaff = await IsVerifiedStaffForExerciseAsync(httpContext, exerciseId.Value, connectionAborted);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !connectionAborted.IsCancellationRequested)
        {
            LogStaffCheckFailed(Context.ConnectionId, exerciseId.Value, ex);
            Context.Abort(); // fail closed AND reconnectable: no staff group, no close-without-reconnect
            return;
        }

        if (isVerifiedStaff)
        {
            // Same exercise id as the join above — the staff group can never point at another exercise.
            await Groups.AddToGroupAsync(Context.ConnectionId, StaffGroupNameFor(exerciseId.Value));
        }

        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Whether the connection's authenticated session is a live <c>staff</c>-kind session whose staff user is
    /// assigned to <paramref name="exerciseId"/>. Fails closed (<c>false</c>) on anything else.
    /// </summary>
    /// <param name="httpContext">The connection request's context (its <c>User</c> is the server-resolved principal).</param>
    /// <param name="exerciseId">The host-resolved exercise the connection's exercise-wide join used.</param>
    /// <param name="cancellationToken">The connection-aborted token.</param>
    /// <returns><c>true</c> only for a verified staff connection on its assigned exercise.</returns>
    private async Task<bool> IsVerifiedStaffForExerciseAsync(HttpContext httpContext, Guid exerciseId, CancellationToken cancellationToken)
    {
        // The principal is assigned ONLY by SessionAuthenticationMiddleware, ONLY for a token it resolved to a
        // live persisted session; Read() yields null for an anonymous / foreign / malformed principal. The kind
        // and staff-user id are therefore server facts, never client assertions. A non-staff principal returns
        // here, before any database work.
        var identity = SessionPrincipal.Read(httpContext.User);
        if (identity is null ||
            !string.Equals(identity.Kind, StaffSessionKind, StringComparison.Ordinal) ||
            identity.StaffUserId is not { } staffUserId)
        {
            return false;
        }

        var staffSession = new ConnectionStaffSessionAccessor(_dbContext, identity.SessionId, staffUserId);
        var assignments = await new StaffAssignmentService(_dbContext, staffSession).GetAssignmentsAsync(cancellationToken);
        if (assignments is null)
        {
            return false;
        }

        // COR-005: the staff user must be assigned to the very exercise this connection joined — the same
        // comparison EngineCockpitStaffAuthorizationFilter makes against the resolved scope.
        return assignments.Any(a => Guid.TryParse(a.ExerciseId, out var assignedExerciseId) && assignedExerciseId == exerciseId);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Staff-group verification failed for hub connection {ConnectionId} on exercise {ExerciseId}; aborting the connection (fail closed, no staff group) so the client reconnects and retries.")]
    private partial void LogStaffCheckFailed(string connectionId, Guid exerciseId, Exception exception);

    /// <summary>
    /// A connection-bound <see cref="ICurrentStaffSessionAccessor"/>: the same "live, non-revoked, unexpired,
    /// <c>staff</c>-kind session bound to a <c>StaffUser</c>" decision the request-time
    /// <c>CurrentStaffSessionAccessor</c> makes, keyed by the session id on the connection's server-resolved
    /// principal instead of a re-read of the raw token (which, for a browser WebSocket, arrived only in the
    /// query string). Lets the hub reuse <see cref="StaffAssignmentService"/> unchanged.
    /// </summary>
    private sealed class ConnectionStaffSessionAccessor : ICurrentStaffSessionAccessor
    {
        private readonly PulseDbContext _dbContext;
        private readonly Guid _sessionId;
        private readonly Guid _staffUserId;

        /// <summary>Creates the accessor for one connection's authenticated session.</summary>
        /// <param name="dbContext">The hub-scope persistence context (<c>Session</c> is unscoped).</param>
        /// <param name="sessionId">The session id the connection's server-resolved principal carries.</param>
        /// <param name="staffUserId">The staff-user id the same principal carries.</param>
        public ConnectionStaffSessionAccessor(PulseDbContext dbContext, Guid sessionId, Guid staffUserId)
        {
            ArgumentNullException.ThrowIfNull(dbContext);

            _dbContext = dbContext;
            _sessionId = sessionId;
            _staffUserId = staffUserId;
        }

        /// <inheritdoc />
        public async Task<CurrentStaffSession?> GetCurrentStaffSessionAsync(CancellationToken cancellationToken = default)
        {
            var session = await _dbContext.Sessions
                .AsNoTracking()
                .SingleOrDefaultAsync(s => s.Id == _sessionId, cancellationToken);

            // Fail closed on anything that is not (still) a live staff session bound to the SAME staff user the
            // principal named.
            if (session is null ||
                !session.IsLive(DateTimeOffset.UtcNow) ||
                !string.Equals(session.Kind, StaffSessionKind, StringComparison.Ordinal) ||
                session.StaffUserId != _staffUserId)
            {
                return null;
            }

            return new CurrentStaffSession
            {
                SessionId = session.Id,
                StaffUserId = _staffUserId,
            };
        }
    }
}
