namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.SignalR;

/// <summary>
/// Which live <see cref="ExerciseRealtimeHub"/> connections were opened under which persisted session
/// (identity-auth-roles/16). The hub checks staff membership only when a connection is made, so without this a
/// connection opened before its session was revoked would keep receiving staff broadcasts. The grant-revoke rule
/// (enrollment removed or role changed, and later OrgRole revoked / person disabled) uses
/// <see cref="ISessionConnectionRevoker"/> to cut those connections the moment the sessions are revoked.
/// </summary>
/// <remarks>
/// <para>
/// Singleton, in-memory, per app instance (SignalR connections are per instance too). Registered by the hub in
/// <c>OnConnectedAsync</c> and removed in <c>OnDisconnectedAsync</c>; holds the connection's
/// <see cref="HubCallerContext"/> because <see cref="HubCallerContext.Abort"/> is the one server-side way to close a
/// specific connection from outside a hub invocation.
/// </para>
/// <para>
/// <b>SINGLE-INSTANCE ASSUMPTION (#602 L-2).</b> There is no SignalR backplane (no Azure SignalR Service, no Redis):
/// the App Service runs ONE instance, so the instance that commits a revocation is the instance holding every live hub
/// connection. Scaling out to more than one instance breaks that — a revocation on instance A would not cut a
/// connection held by instance B (until it reconnects and is re-verified) — so a scale-out must first move this
/// registry (and the hub's group fan-out) onto a backplane or a cross-instance revoke signal.
/// </para>
/// <para>
/// <b>The register-after-take race.</b> A revocation commits, then <see cref="Take"/>s the session's connections; a
/// connection whose connect-time check ran before the commit but whose <see cref="Register"/> lands after the take is not
/// in that take. For a STAFF connection (the staff group carries staff-only content) the hub therefore re-reads the
/// session AFTER registering, and BEFORE joining any group. It cuts the connection itself if the session is no longer live
/// or no longer bound to the connection's exercise (<c>ExerciseRealtimeHub.RegisterLiveAsync</c>). A take landing
/// between that re-read and the group joins is caught by the hub's post-join <see cref="IsRegistered"/> check. Each
/// operation here is atomic under one lock, so no registration can be lost to a concurrent unregister (adversarial
/// review W2). What is NOT claimed: the instant between the hub's group joins and its post-join check. In that instant a
/// connection whose take already ran sits in the groups, but it is already aborted, so it is not a delivery channel. A
/// participant / read-only connection is registered without that re-read — its path deliberately never opens the
/// database — so the same narrow window remains for it (it can only keep the exercise-wide group it was already entitled
/// to at connect time, until it disconnects). Accepted as documented (#602 review); the participant-side revoke race is
/// tracked with #659 (revoke non-staff sessions or gate the hub).
/// </para>
/// </remarks>
public sealed class SessionConnectionRegistry
{
    // #602 adversarial-review W2: ONE lock over plain dictionaries, not nested ConcurrentDictionaries. With nested
    // concurrent sets, "unregister A, see the set empty, drop the set" and "fetch the set, add B" are separate atomic
    // steps. B could fetch the set before A dropped it, then write into the orphan, and a later revoke's Take would miss
    // B. A single lock makes each operation atomic as a whole. At this scale (one register on connect, one unregister on
    // disconnect, one take per revoked session, all O(1) in-memory) contention is negligible. It is also simpler to prove
    // than a lock-free verify-and-retry loop.
    private readonly object _gate = new();
    private readonly Dictionary<Guid, Dictionary<string, RegisteredConnection>> _bySession = [];

    /// <summary>Records that <paramref name="context"/> was opened under <paramref name="sessionId"/>.</summary>
    /// <param name="sessionId">The persisted session id of the connecting principal.</param>
    /// <param name="exerciseId">The exercise whose groups the connection joined.</param>
    /// <param name="context">The connection's caller context.</param>
    public void Register(Guid sessionId, Guid exerciseId, HubCallerContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        lock (_gate)
        {
            if (!_bySession.TryGetValue(sessionId, out var connections))
            {
                connections = new Dictionary<string, RegisteredConnection>(StringComparer.Ordinal);
                _bySession[sessionId] = connections;
            }

            connections[context.ConnectionId] = new RegisteredConnection(exerciseId, context);
        }
    }

    /// <summary>Forgets a connection (on disconnect).</summary>
    /// <param name="sessionId">The session it was registered under.</param>
    /// <param name="connectionId">The connection id.</param>
    public void Unregister(Guid sessionId, string connectionId)
    {
        lock (_gate)
        {
            if (_bySession.TryGetValue(sessionId, out var connections)
                && connections.Remove(connectionId)
                && connections.Count == 0)
            {
                _bySession.Remove(sessionId);
            }
        }
    }

    /// <summary>Whether <paramref name="connectionId"/> is still registered under <paramref name="sessionId"/>.</summary>
    /// <param name="sessionId">The session.</param>
    /// <param name="connectionId">The connection id.</param>
    /// <returns><c>false</c> once a revoke's <see cref="Take"/> (or an unregister) removed it.</returns>
    public bool IsRegistered(Guid sessionId, string connectionId)
    {
        lock (_gate)
        {
            return _bySession.TryGetValue(sessionId, out var connections) && connections.ContainsKey(connectionId);
        }
    }

    /// <summary>Removes and returns every connection registered under <paramref name="sessionId"/>.</summary>
    /// <param name="sessionId">The revoked session.</param>
    /// <returns>The connections that were open under it.</returns>
    public IReadOnlyList<(string ConnectionId, RegisteredConnection Connection)> Take(Guid sessionId)
    {
        lock (_gate)
        {
            return _bySession.Remove(sessionId, out var connections)
                ? connections.Select(pair => (pair.Key, pair.Value)).ToList()
                : [];
        }
    }

    /// <summary>One registered connection.</summary>
    /// <param name="ExerciseId">The exercise whose groups it joined.</param>
    /// <param name="Context">Its caller context (for <see cref="HubCallerContext.Abort"/>).</param>
    public sealed record RegisteredConnection(Guid ExerciseId, HubCallerContext Context);
}

/// <summary>Cuts the live hub connections of revoked sessions (identity-auth-roles/16 grant-revoke rule).</summary>
public interface ISessionConnectionRevoker
{
    /// <summary>
    /// Removes every hub connection opened under one of <paramref name="sessionIds"/> from its exercise and staff
    /// groups, then aborts it. Call AFTER the revocation is committed.
    /// </summary>
    /// <param name="sessionIds">The just-revoked session ids.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    Task RevokeAsync(IEnumerable<Guid> sessionIds, CancellationToken cancellationToken = default);
}

/// <summary>The production <see cref="ISessionConnectionRevoker"/> over <see cref="SessionConnectionRegistry"/>.</summary>
public sealed class SessionConnectionRevoker : ISessionConnectionRevoker
{
    private readonly SessionConnectionRegistry _registry;
    private readonly IHubContext<ExerciseRealtimeHub>? _hubContext;

    /// <summary>Creates the revoker.</summary>
    /// <param name="registry">The connection → session registry.</param>
    /// <param name="hubContext">The hub context for group removal; absent in a host without SignalR (nothing to cut).</param>
    public SessionConnectionRevoker(SessionConnectionRegistry registry, IHubContext<ExerciseRealtimeHub>? hubContext = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        _registry = registry;
        _hubContext = hubContext;
    }

    /// <inheritdoc />
    public async Task RevokeAsync(IEnumerable<Guid> sessionIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sessionIds);

        foreach (var sessionId in sessionIds.Distinct())
        {
            foreach (var (connectionId, connection) in _registry.Take(sessionId))
            {
                if (_hubContext is not null)
                {
                    // Out of the groups FIRST, so not one more staff broadcast is fanned to it while the abort lands.
                    await _hubContext.Groups.RemoveFromGroupAsync(
                        connectionId, ExerciseRealtimeHub.StaffGroupNameFor(connection.ExerciseId), cancellationToken);
                    await _hubContext.Groups.RemoveFromGroupAsync(
                        connectionId, ExerciseRealtimeHub.GroupNameFor(connection.ExerciseId), cancellationToken);
                }

                connection.Context.Abort();
            }
        }
    }
}
